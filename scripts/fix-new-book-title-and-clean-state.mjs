// scripts/fix-new-book-title-and-clean-state.mjs

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const APP_FILE = path.join(ROOT, "App.tsx");

if (!fs.existsSync(APP_FILE)) {
  console.error("❌ No existe App.tsx en:", ROOT);
  process.exit(1);
}

const BACKUP_FILE = `${APP_FILE}.bak_new_book_title_state`;
fs.copyFileSync(APP_FILE, BACKUP_FILE);

let code = fs.readFileSync(APP_FILE, "utf8");

const helperMarker = "function deriveSafeNewBookTitle";

const helper = `
function deriveSafeNewBookTitle(rawIdea: unknown): string {
  const idea = String(rawIdea ?? "")
    .replace(/\\r/g, "\\n")
    .replace(/[“”"']/g, "")
    .replace(/\\s+/g, " ")
    .trim();

  if (!idea) return "Nuevo libro";

  const labeledMatch = idea.match(
    /(?:t[ií]tulo|titulo|nombre del libro)\\s*[:\\-–—]\\s*([^\\n.!?]{3,160})/i
  );

  const labeled = labeledMatch?.[1]?.trim();

  if (labeled) {
    return labeled.slice(0, 140);
  }

  const firstSentence = idea
    .split(/[.!?\\n]/)
    .map((part) => part.trim())
    .find((part) => part.length >= 3);

  if (firstSentence && firstSentence.length <= 140) {
    return firstSentence;
  }

  const words = idea.split(/\\s+/).filter(Boolean);
  const generated = words.slice(0, 12).join(" ").trim();

  if (generated) {
    return generated.length > 140
      ? generated.slice(0, 137).trimEnd() + "..."
      : generated;
  }

  return "Nuevo libro";
}

function createFreshBookState(
  projectId: string,
  bookTitle: string,
  bookTopic: string
): any {
  return {
    project_id: projectId,
    book_title: bookTitle,
    bookTitle: bookTitle,
    book_topic: bookTopic,

    proposal: "",
    introduction: "",
    chapters: [],
    sections: [],
    outline_12: [],
    continuity_pack: {},

    progress: {
      total_words: 0,
      proposal_words: 0,
      introduction_words: 0,
      chapters_words: [],
      completion_percent_est: 0
    },

    menu_items: [],
    active_view: "DOSSIER",
    active_section_id: null
  };
}
`;

if (!code.includes(helperMarker)) {
  const markers = [
    "export default function",
    "function App(",
    "const App =",
  ];

  let insertIndex = -1;

  for (const marker of markers) {
    const found = code.indexOf(marker);

    if (found >= 0) {
      insertIndex = found;
      break;
    }
  }

  if (insertIndex < 0) {
    console.error("❌ No pude localizar el componente principal en App.tsx.");
    process.exit(1);
  }

  code =
    code.slice(0, insertIndex) +
    helper +
    "\n\n" +
    code.slice(insertIndex);

  console.log("✅ Funciones auxiliares agregadas.");
} else {
  console.log("ℹ️ Las funciones auxiliares ya existen.");
}

const replacements = [
  {
    from: `const title = idea.length < 70 ? idea.trim() : "Libro sin título";`,
    to: `const title = deriveSafeNewBookTitle(idea);`,
  },
  {
    from: `const title = idea.length < 70 ? idea.trim() : 'Libro sin título';`,
    to: `const title = deriveSafeNewBookTitle(idea);`,
  },
  {
    from: `return "Libro sin título";`,
    to: `return deriveSafeNewBookTitle(idea);`,
  },
  {
    from: `return 'Libro sin título';`,
    to: `return deriveSafeNewBookTitle(idea);`,
  },
  {
    from: `book_title: dbProject.title,`,
    to: `book_title: deriveSafeNewBookTitle(dbProject.title || idea),`,
  },
  {
    from: `title: dbProject.title,`,
    to: `title: deriveSafeNewBookTitle(dbProject.title || idea),`,
  },
  {
    from: `master_document: { title: dbProject.title, text: "", chunks: [] } as any,`,
    to: `master_document: {
        title: deriveSafeNewBookTitle(dbProject.title || idea),
        text: "",
        chunks: []
      } as any,`,
  },
];

for (const item of replacements) {
  if (code.includes(item.from)) {
    code = code.split(item.from).join(item.to);
    console.log("✅ Reemplazo aplicado:", item.from.slice(0, 70));
  }
}

const seedStart = code.indexOf("const seedState =");
const taskStart = code.indexOf(
  'const task: ComposerTask = { action: "BUILD_FULL_DOSSIER"',
  seedStart
);

if (seedStart >= 0 && taskStart > seedStart) {
  const before = code.slice(0, seedStart);
  const after = code.slice(taskStart);

  const cleanSeed = `const seedState = createFreshBookState(
        dbProject.id,
        deriveSafeNewBookTitle(dbProject.title || idea),
        String(dbProject.topic || idea || "").trim()
      );

      `;

  code = before + cleanSeed + after;

  console.log("✅ seedState reemplazado por un estado limpio.");
} else {
  console.log(
    "⚠️ No encontré automáticamente seedState antes de BUILD_FULL_DOSSIER."
  );
}

fs.writeFileSync(APP_FILE, code, "utf8");

console.log("");
console.log("✅ App.tsx actualizado.");
console.log("✅ Backup creado:", BACKUP_FILE);
console.log("");
console.log("Ejecuta ahora:");
console.log("npm run build");