
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import type { Project } from '../types';

// Simple markdown to plain text converter
const markdownToText = (markdown: string): string => {
  return markdown
    .replace(/### (.*)/g, '$1')
    .replace(/## (.*)/g, '$1')
    .replace(/# (.*)/g, '$1')
    .replace(/\*\*(.*)\*\*/g, '$1')
    .replace(/\*(.*)\*/g, '$1')
    .replace(/^- (.*)/gm, '• $1')
    .replace(/(\r\n|\n|\r)/gm, "\n");
};

export const generatePdf = async (project: Project) => {
  const contentElement = document.getElementById('book-content-container');
  if (!contentElement) {
    console.error('Book content container not found');
    return;
  }

  contentElement.scrollTop = 0;
  await new Promise(resolve => setTimeout(resolve, 500));

  const canvas = await html2canvas(contentElement, {
    scale: 2,
    backgroundColor: '#ffffff',
    useCORS: true,
    scrollY: -window.scrollY,
    windowWidth: contentElement.scrollWidth,
    windowHeight: contentElement.scrollHeight,
  });

  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF({
    orientation: 'p',
    unit: 'px',
    format: [canvas.width, canvas.height],
  });

  pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
  pdf.save(`${project.title.replace(/ /g, '_')}.pdf`);
};


export const generateDocx = async (project: Project) => {
  const { state } = project;
  const docSections = [];

  // Title
  docSections.push(new Paragraph({
      children: [new TextRun({ text: state.book_title, bold: true, size: 48 })],
      heading: HeadingLevel.TITLE,
      spacing: { after: 400 },
  }));

  // Proposal
  if (state.proposal.text) {
    docSections.push(new Paragraph({
        children: [new TextRun({ text: "Propuesta Editorial", bold: true, size: 36 })],
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 },
    }));
    markdownToText(state.proposal.text).split('\n').forEach(text => {
        docSections.push(new Paragraph(text));
    });
  }

  // Introduction
  if (state.introduction.text) {
    docSections.push(new Paragraph({
        children: [new TextRun({ text: "Introducción", bold: true, size: 36 })],
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 },
    }));
    markdownToText(state.introduction.text).split('\n').forEach(text => {
        docSections.push(new Paragraph(text));
    });
  }

  // Chapters
  [...state.chapters].sort((a, b) => a.chapter_number - b.chapter_number).forEach(chapter => {
    docSections.push(new Paragraph({
        children: [new TextRun({ text: `Capítulo ${chapter.chapter_number}: ${chapter.title}`, bold: true, size: 32 })],
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 400, after: 200 },
    }));

    markdownToText(chapter.text).split('\n').forEach(text => {
        docSections.push(new Paragraph(text));
    });
  });

  const doc = new Document({
    sections: [{
      properties: {},
      children: docSections,
    }],
  });

  const blob = await Packer.toBlob(doc);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${project.title.replace(/ /g, '_')}.docx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
