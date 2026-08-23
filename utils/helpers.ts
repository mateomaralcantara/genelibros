
export const countWords = (text: string | undefined): number => {
  if (!text) return 0;
  // Eliminar símbolos de markdown básicos para un conteo más preciso
  const cleanText = text
    .replace(/[#*`~_]/g, '')
    .replace(/\[.*\]\(.*\)/g, '') // Enlaces
    .trim();

  if (!cleanText) return 0;
  return cleanText.split(/\s+/).length;
};
