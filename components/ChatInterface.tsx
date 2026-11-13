
import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage } from '../types';
import { UserIcon, BotIcon, SendIcon, AlertTriangleIcon } from './Icons';
import PromptPlanner from './PromptPlanner';

interface ChatInterfaceProps {
  messages: ChatMessage[];
  isLoading: boolean;
  onSendMessage: (text: string) => void;
  error: string | null;
  /** Texto inicial de la caja (p. ej. lo que el visitante escribió antes de registrarse). */
  initialText?: string;
  /** Visitante sin cuenta: en vez de enviar o abrir el planificador, pide inscribirse. */
  onRequireSignup?: (pendingText: string) => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({
  messages,
  isLoading,
  onSendMessage,
  error,
  initialText = '',
  onRequireSignup,
}) => {
  const [inputText, setInputText] = useState(initialText);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [messages]);

  // Recupera lo que el visitante escribió antes de registrarse.
  useEffect(() => {
    if (initialText) setInputText((current) => current || initialText);
  }, [initialText]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (onRequireSignup) {
      onRequireSignup(inputText);
      return;
    }
    onSendMessage(inputText);
    setInputText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-900 overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex items-start gap-4 ${
              msg.role === 'user' ? 'justify-end' : ''
            }`}
          >
            {msg.role === 'model' && (
              <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center flex-shrink-0">
                <BotIcon className="w-5 h-5 text-white" />
              </div>
            )}
            <div
              className={`max-w-3xl rounded-xl p-4 ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-none'
                  : 'bg-slate-800 text-slate-200 rounded-bl-none'
              }`}
            >
              <div className="prose prose-invert prose-sm md:prose-base prose-pre:bg-slate-900/50 prose-pre:p-4 prose-pre:rounded-md">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {msg.content}
                </ReactMarkdown>
              </div>
            </div>
             {msg.role === 'user' && (
              <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0">
                <UserIcon className="w-5 h-5 text-slate-300" />
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-slate-700 bg-slate-800/50">
        {error && (
            <div className="mb-2 p-3 bg-red-900/50 border border-red-500/50 rounded-lg text-red-300 text-sm flex items-center gap-2">
                <AlertTriangleIcon className="w-4 h-4"/>
                <span>{error}</span>
            </div>
        )}
        {plannerOpen ? (
          <div className="mb-3">
            <PromptPlanner
              disabled={isLoading}
              onClose={() => setPlannerOpen(false)}
              onUse={(prompt) => {
                setPlannerOpen(false);
                onSendMessage(prompt);
              }}
              onEdit={(prompt) => {
                setPlannerOpen(false);
                setInputText(prompt);
              }}
            />
          </div>
        ) : (
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <button
              type="button"
              onClick={() => (onRequireSignup ? onRequireSignup(inputText) : setPlannerOpen(true))}
              disabled={isLoading}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 font-black uppercase tracking-widest text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              🧭 Planificador de prompt
            </button>
            <span>Responde unas preguntas y armamos el encargo de tu libro. También puedes pegar tu propio prompt abajo.</span>
          </div>
        )}
        <form onSubmit={handleSend} className="relative">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribe tu comando aquí... (ej. NUEVO LIBRO: una guía sobre...)"
            className="w-full bg-slate-700 text-slate-100 rounded-lg p-3 pr-20 resize-none border border-slate-600 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition duration-200"
            rows={Math.min(8, Math.max(1, inputText.split('\n').length))}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !inputText.trim()}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-slate-600 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : (
                <SendIcon className="w-5 h-5" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChatInterface;
