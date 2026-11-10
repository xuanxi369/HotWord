import { useEffect, useId, type ReactNode } from 'react';
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, ChevronDown, LoaderCircle, X } from 'lucide-react';

export const spring = { type: 'spring' as const, stiffness: 420, damping: 34, mass: 0.7 };
export function Tip({ text, children }: { text: string; children: ReactNode }) {
  return <Tooltip.Root><Tooltip.Trigger asChild>{children}</Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="tooltip" sideOffset={8}>{text}<Tooltip.Arrow className="tooltip-arrow"/></Tooltip.Content></Tooltip.Portal></Tooltip.Root>;
}
export function AnimatedNumber({ value }: { value: number }) {
  const current = useMotionValue(value);
  const display = useTransform(current, n => Math.round(n).toLocaleString('zh-CN'));
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) { current.set(value); return; }
    const control = animate(current, value, { duration: 0.45, ease: [0.22, 1, 0.36, 1] });
    return () => control.stop();
  }, [value, current, reduced]);
  return <><motion.span aria-hidden="true">{display}</motion.span><span className="sr-only">{value.toLocaleString('zh-CN')}</span></>;
}
export function Segmented({ value, options, onChange, label }: { value: string; options: { value: string; label: string; count?: number }[]; onChange: (value: string) => void; label: string }) {
  const id = useId();
  const reduced = useReducedMotion();
  return <div className="segmented" role="group" aria-label={label}>{options.map(option => <button type="button" key={option.value} aria-pressed={value === option.value} onClick={() => onChange(option.value)} className={value === option.value ? 'is-active' : ''}>
    {value === option.value && <motion.span className="segment-indicator" layoutId={`segment-${id}`} transition={reduced ? { duration: 0 } : spring}/>}
    <span className="segment-label">{option.label}{option.count !== undefined && <small>{option.count}</small>}</span>
  </button>)}</div>;
}
export function Switch({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  const reduced = useReducedMotion();
  return <button type="button" className={`switch-control ${checked ? 'on' : ''}`} role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}>
    <span className="switch-track"><motion.span className="switch-thumb" animate={{ x: checked ? 18 : 0 }} transition={reduced ? { duration: 0 } : spring}><Check size={10}/></motion.span></span><span>{label}</span>
  </button>;
}
export function Toggle({ checked, onChange, label, disabled = false, pinned = false }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean; pinned?: boolean }) {
  const reduced = useReducedMotion();
  return <Tip text={label}><motion.button type="button" className={`check-toggle ${checked ? 'checked' : ''} ${pinned ? 'pin-toggle' : ''}`} role="checkbox" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} whileTap={disabled || reduced ? undefined : { scale: 0.85 }} transition={reduced ? { duration: 0 } : spring}>
    <motion.span animate={{ scale: checked ? 1 : 0, opacity: checked ? 1 : 0 }} transition={reduced ? { duration: 0 } : spring}><Check size={12} strokeWidth={3}/></motion.span>
  </motion.button></Tip>;
}
export function Disclosure({ title, children, className = '', open, onToggle }: { title: ReactNode; children: ReactNode; className?: string; open: boolean; onToggle: () => void }) {
  const id = useId();
  const reduced = useReducedMotion();
  return <div className={`disclosure ${className} ${open ? 'expanded' : ''}`}>
    <button type="button" className="disclosure-trigger" aria-expanded={open} aria-controls={id} onClick={onToggle}>{title}<motion.span animate={{ rotate: open ? 180 : 0 }} transition={reduced ? { duration: 0 } : spring}><ChevronDown size={15}/></motion.span></button>
    <div id={id} className="disclosure-grid" aria-hidden={!open} inert={!open}><div className="disclosure-inner">{children}</div></div>
  </div>;
}
export function PrioritySlider({ value, onChange, label }: { value: number; onChange: (value: number) => void; label: string }) {
  return <div className="priority-slider"><input type="range" min={0} max={100} step={1} value={value} aria-label={label} onChange={e => onChange(Number(e.target.value))} style={{ backgroundSize: `${value}% 100%` }}/><output aria-hidden="true">{value}</output></div>;
}
export function ConfirmDialog({ open, onClose, onConfirm, busy, title, children, returnFocus }: { open: boolean; onClose: () => void; onConfirm: () => void; busy: boolean; title: string; children: ReactNode; returnFocus: () => void }) {
  return <Dialog.Root open={open} onOpenChange={value => { if (!value && !busy) onClose(); }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content" onCloseAutoFocus={e => { e.preventDefault(); returnFocus(); }} onEscapeKeyDown={e => { if (busy) e.preventDefault(); }} onPointerDownOutside={e => { if (busy) e.preventDefault(); }}>
    <Dialog.Title>{title}</Dialog.Title><Dialog.Description>{children}</Dialog.Description>
    <button className="dialog-close icon-button" type="button" aria-label="关闭对话框" disabled={busy} onClick={onClose}><X size={18}/></button>
    <div className="dialog-actions"><button className="button secondary" disabled={busy} onClick={onClose}>取消</button><button className="button danger" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle size={16} className="spin"/> : null}删除任务</button></div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
