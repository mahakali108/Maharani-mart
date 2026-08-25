'use client';

import Link from 'next/link';
import Image from 'next/image';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { ArrowUp, Bot, Check, ImagePlus, Loader2, Mic, RotateCcw, ShieldCheck, Sparkles, UserRound } from 'lucide-react';
import type { AICard, AgentEvent, AISurface } from '@/lib/ai/types';
import { cn } from '@/lib/utils/cn';

interface ChatMessage { id: string; role: 'user' | 'assistant'; text: string; cards: AICard[]; loading?: boolean; error?: boolean; }
interface QuickAction { label: string; prompt: string; }

function metricTone(quality?: string) {
  if (quality === 'estimate') return 'text-amber-700';
  if (quality === 'unavailable') return 'text-slate-400';
  return 'text-slate-950';
}

function ResultCard({ card, onPrompt, onConfirm, confirming }: { card: AICard; onPrompt: (value: string) => void; onConfirm: (token: string) => void; confirming: boolean }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-[0_8px_24px_rgba(30,64,175,0.08)]">
      <div className="flex gap-3 p-3.5 sm:p-4">
        {card.imageUrl ? <Image src={card.imageUrl} alt="" width={64} height={64} unoptimized className="h-16 w-16 shrink-0 rounded-xl bg-slate-50 object-contain p-1" /> : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-bold text-slate-950">{card.title}</p>
              {card.subtitle ? <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{card.subtitle}</p> : null}
            </div>
            {card.badge ? <span className="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-[9px] font-bold capitalize text-blue-700">{card.badge}</span> : null}
          </div>
          {card.metrics?.length ? (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {card.metrics.map((metric) => <div key={`${metric.label}-${metric.value}`} className="rounded-xl bg-slate-50 px-2.5 py-2"><p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">{metric.label}</p><p className={cn('mt-0.5 text-[11px] font-bold', metricTone(metric.quality))}>{metric.value}</p></div>)}
            </div>
          ) : null}
        </div>
      </div>
      {card.lines?.length ? <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto border-t border-slate-100 px-4">{card.lines.map((line, index) => <div key={`${line.label}-${index}`} className="flex items-start justify-between gap-3 py-2.5 text-[11px]"><div><p className="font-semibold text-slate-800">{line.label}</p>{line.detail ? <p className="mt-0.5 text-[10px] leading-4 text-slate-500">{line.detail}</p> : null}</div><span className="shrink-0 font-bold text-slate-900">{line.value}</span></div>)}</div> : null}
      {card.source ? <p className="border-t border-slate-100 px-4 py-2 text-[9px] leading-4 text-slate-400"><ShieldCheck className="mr-1 inline h-3 w-3 text-emerald-600" /> Source: {card.source}</p> : null}
      {card.actions?.length ? <div className="flex flex-wrap gap-2 border-t border-slate-100 bg-slate-50/70 p-3">{card.actions.map((action, index) => {
        const classes = cn('inline-flex h-9 items-center justify-center rounded-xl px-3 text-[10px] font-bold transition', action.tone === 'primary' ? 'bg-blue-700 text-white hover:bg-blue-800' : action.tone === 'danger' ? 'bg-red-600 text-white hover:bg-red-700' : 'border border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:text-blue-700');
        if (action.type === 'link' && action.href) return <Link key={index} href={action.href} className={classes}>{action.label}</Link>;
        if (action.type === 'confirm_tool' && action.confirmationToken) return <button key={index} type="button" disabled={confirming} onClick={() => onConfirm(action.confirmationToken!)} className={classes}>{confirming ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}{action.label}</button>;
        return <button key={index} type="button" onClick={() => onPrompt(action.value ?? action.label)} className={classes}>{action.label}</button>;
      })}</div> : null}
    </article>
  );
}

export function MaharaniAIChat({ surface, title, subtitle, quickActions }: { surface: AISurface; title: string; subtitle: string; quickActions: QuickAction[] }) {
  const welcome = surface === 'retailer'
    ? 'Namaste! Main products, aapki pricing, schemes, credit, orders aur reorder suggestions ko current Maharani Traders data se verify karke help kar sakti hoon.'
    : surface === 'staff'
      ? 'I can inspect authorized stock, batches, expiry, GRNs and transfers. I will not modify inventory.'
      : surface === 'salesman'
        ? 'I can help with products, assigned retailer orders, schemes and your authorized sales information.'
        : 'I can analyze authorized sales, products, orders, inventory and business trends using current Maharani Traders data.';
  const [messages, setMessages] = useState<ChatMessage[]>([{ id: 'welcome', role: 'assistant', text: welcome, cards: [] }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const conversationRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const node = conversationRef.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function streamRequest(message: string, confirmationToken?: string) {
    if (busy || !message.trim()) return;
    setBusy(true);
    if (confirmationToken) setConfirming(true);
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', text: confirmationToken ? 'Confirm cart change' : message.trim(), cards: [] };
    const assistantId = crypto.randomUUID();
    const history = messages.filter((item) => item.text && item.id !== 'welcome').slice(-12).map((item) => ({
      role: item.role,
      content: `${item.text}${item.cards.length ? `\nCurrent visual result context: ${item.cards.slice(-5).map((card) => `${card.type}:${card.title}${card.id ? ` [${card.id}]` : ''}`).join('; ')}` : ''}`.slice(0, 2000),
    }));
    setMessages((current) => [...current, userMessage, { id: assistantId, role: 'assistant', text: '', cards: [], loading: true }]);
    setInput('');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ surface, message, history, confirmationToken }), signal: controller.signal });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? 'AI service temporarily unavailable.');
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';
        for (const block of blocks) {
          const raw = block.split('\n').find((line) => line.startsWith('data: '))?.slice(6);
          if (!raw) continue;
          const event = JSON.parse(raw) as AgentEvent;
          setMessages((current) => current.map((item) => item.id !== assistantId ? item : event.type === 'text' ? { ...item, text: item.text + event.delta, loading: false } : event.type === 'cards' ? { ...item, cards: [...item.cards, ...event.cards], loading: false } : event.type === 'error' ? { ...item, text: event.message, error: true, loading: false } : event.type === 'done' ? { ...item, loading: false } : item));
        }
        if (done) break;
      }
    } catch (error) {
      setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, text: error instanceof Error ? error.message : 'AI service temporarily unavailable. You can continue using the normal Maharani Traders features.', error: true, loading: false } : item));
    } finally {
      setBusy(false); setConfirming(false); abortRef.current = null;
    }
  }

  function submit(event: FormEvent) { event.preventDefault(); void streamRequest(input); }

  async function resetMemory() {
    if (!window.confirm('Reset saved Maharani AI business preferences? Chat messages on this screen will also be cleared.')) return;
    const response = await fetch('/api/ai/memory', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ surface }) });
    if (response.ok) setMessages([{ id: crypto.randomUUID(), role: 'assistant', text: 'Saved business preferences have been reset.', cards: [] }]);
  }

  return (
    <div className="mx-auto max-w-5xl overflow-hidden rounded-[1.5rem] border border-blue-100 bg-white shadow-[0_24px_70px_rgba(30,64,175,0.12)]">
      <header className="bg-gradient-to-br from-blue-700 via-blue-800 to-slate-950 px-4 py-5 text-white sm:px-6 sm:py-6">
        <div className="flex items-start justify-between gap-4"><div className="flex gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/20"><Sparkles className="h-5 w-5" /></span><div><h1 className="text-xl font-bold sm:text-2xl">{title}</h1><p className="mt-1 max-w-2xl text-xs leading-5 text-blue-100">{subtitle}</p></div></div><button type="button" onClick={() => void resetMemory()} className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-white/10 px-3 text-[10px] font-bold text-blue-50 hover:bg-white/15" title="Reset safe business memory"><RotateCcw className="h-3.5 w-3.5" /><span className="hidden sm:inline">Reset memory</span></button></div>
        <div className="mt-4 flex items-center gap-2 text-[9px] text-blue-100"><ShieldCheck className="h-3.5 w-3.5 text-emerald-300" /> RLS-protected tools · Confirmed cart writes · No automatic orders</div>
      </header>

      <div className="border-b border-slate-100 bg-white px-3 py-3 sm:px-5"><div className="scrollbar-none flex gap-2 overflow-x-auto">{quickActions.map((action) => <button key={action.label} type="button" disabled={busy} onClick={() => void streamRequest(action.prompt)} className="shrink-0 rounded-full border border-blue-100 bg-blue-50 px-3 py-2 text-[10px] font-bold text-blue-700 transition hover:bg-blue-100 disabled:opacity-50">{action.label}</button>)}</div></div>

      <main ref={conversationRef} className="h-[min(62vh,650px)] space-y-5 overflow-y-auto bg-[#f8faff] p-3 sm:p-6" aria-live="polite">
        {messages.map((message) => <div key={message.id} className={cn('flex gap-2.5', message.role === 'user' && 'justify-end')}>
          {message.role === 'assistant' ? <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-700 text-white"><Bot className="h-4 w-4" /></span> : null}
          <div className={cn('max-w-[88%] space-y-3 sm:max-w-[78%]', message.role === 'user' && 'items-end')}>
            {(message.text || message.loading) ? <div className={cn('rounded-2xl px-3.5 py-3 text-xs leading-5 shadow-sm sm:text-sm', message.role === 'user' ? 'rounded-br-md bg-blue-700 text-white' : message.error ? 'rounded-bl-md border border-red-100 bg-red-50 text-red-700' : 'rounded-bl-md border border-slate-100 bg-white text-slate-700')}>{message.text}{message.loading ? <Loader2 className="ml-2 inline h-4 w-4 animate-spin text-blue-600" /> : null}</div> : null}
            {message.cards.map((card, index) => <ResultCard key={`${card.type}-${card.id ?? index}-${index}`} card={card} onPrompt={(value) => { setInput(value); }} onConfirm={(token) => void streamRequest('Confirm cart change', token)} confirming={confirming} />)}
          </div>
          {message.role === 'user' ? <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-200 text-slate-600"><UserRound className="h-4 w-4" /></span> : null}
        </div>)}
      </main>

      <footer className="border-t border-slate-200 bg-white p-3 sm:p-4">
        <form onSubmit={submit} className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-100">
          <button type="button" disabled className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-300" title="Image understanding is not configured"><ImagePlus className="h-4.5 w-4.5" /></button>
          <textarea value={input} onChange={(event) => setInput(event.target.value.slice(0, 2000))} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (input.trim()) void streamRequest(input); } }} rows={1} placeholder="Ask in Hindi, Hinglish or English…" className="max-h-28 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-xs text-slate-900 outline-none placeholder:text-slate-400 sm:text-sm" />
          <button type="button" disabled className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-300" title="Voice input is ready for a future supported provider"><Mic className="h-4.5 w-4.5" /></button>
          <button type="submit" disabled={busy || !input.trim()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-700 text-white transition hover:bg-blue-800 disabled:bg-slate-300"><ArrowUp className="h-4 w-4" /></button>
        </form>
        <p className="mt-2 text-center text-[9px] text-slate-400">Maharani AI can make mistakes in language, but business values are shown only from verified tools. Review before acting.</p>
      </footer>
    </div>
  );
}
