
import React from 'react';
import type { BookProposal } from '../types';
import { BookOpenIcon, ListIcon, UsersIcon, ClipboardCheckIcon, PaletteIcon } from './Icons';

type SectionProps = {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
};

const Section: React.FC<SectionProps> = ({ title, icon, children }) => (
  <div>
    <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-100 mb-3">
      {icon}
      <span>{title}</span>
    </h3>
    <div className="text-slate-300 text-sm prose prose-invert prose-sm max-w-none">{children}</div>
  </div>
);

type InfoCardProps = {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
};

const InfoCard: React.FC<InfoCardProps> = ({ title, icon, children }) => (
  <div className="bg-slate-900/50 p-4 rounded-lg h-full">
    <h4 className="flex items-center gap-2 text-base font-semibold text-slate-200 mb-2">
      {icon}
      <span>{title}</span>
    </h4>
    <p className="text-sm text-slate-400">{children}</p>
  </div>
);


const BookProposalDisplay: React.FC<{ proposal: BookProposal }> = ({ proposal }) => {
  return (
    <div className="p-6 bg-slate-800 h-full">
      <h2 className="text-xl font-bold text-white mb-6 border-b border-slate-700 pb-3">
        Propuesta de Libro
      </h2>

      <div className="space-y-6">
        <Section title="Resumen de la Idea" icon={<BookOpenIcon className="w-5 h-5" />}>
          <p>{proposal.summary}</p>
        </Section>

        <div className="grid md:grid-cols-2 gap-6">
          <Section title="Opciones de Título" icon={<ListIcon className="w-5 h-5" />}>
            <ul className="list-none p-0 m-0 space-y-2">
              {proposal.titleOptions.map((title, i) => (
                <li key={`title-${i}`} className="flex items-start">
                  <span className="text-indigo-400 mr-2">›</span>
                  <span>{title}</span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Opciones de Subtítulo" icon={<ListIcon className="w-5 h-5" />}>
             <ul className="list-none p-0 m-0 space-y-2">
              {proposal.subtitleOptions.map((subtitle, i) => (
                <li key={`subtitle-${i}`} className="flex items-start">
                  <span className="text-indigo-400 mr-2">›</span>
                  <span>{subtitle}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>

        <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-100 mb-3">
                Detalles Clave
            </h3>
            <div className="grid md:grid-cols-3 gap-4">
            <InfoCard title="Público Objetivo" icon={<UsersIcon className="w-5 h-5" />}>
                {proposal.targetAudience}
            </InfoCard>
            <InfoCard title="Objetivo Principal" icon={<ClipboardCheckIcon className="w-5 h-5" />}>
                {proposal.mainGoal}
            </InfoCard>
            <InfoCard title="Tono y Estilo" icon={<PaletteIcon className="w-5 h-5" />}>
                {proposal.toneAndStyle}
            </InfoCard>
            </div>
        </div>
      </div>
    </div>
  );
};

export default BookProposalDisplay;
