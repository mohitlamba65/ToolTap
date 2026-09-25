import { useEffect, useRef, useState } from "react";
import gsap from "gsap";

const STEPS = [
  { id: "phone", title: "Phone", body: "A customer writes in WhatsApp — Hi, a question, or a tap on a button." },
  { id: "wa", title: "WhatsApp", body: "WhatsApp delivers that message to ToolTap. You never hand over a new app." },
  { id: "files", title: "Your files", body: "We search only the documents you uploaded. If nothing matches, we say so." },
  { id: "reply", title: "Reply", body: "A short answer goes back, often with buttons for the next step." },
];

interface Props {
  documentCount: number;
  onAddKnowledge: () => void;
}

export function PipelineStepper({ documentCount, onAddKnowledge }: Props) {
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!root.current) return;
    const ctx = gsap.context(() => {
      gsap.from(".pipe-step", {
        y: 18,
        opacity: 0,
        stagger: 0.09,
        duration: 0.45,
        ease: "power2.out",
      });
      gsap.from(".pipe-line", { scaleX: 0, duration: 0.7, ease: "power2.inOut", delay: 0.15 });
    }, root);
    return () => ctx.revert();
  }, []);

  const step = STEPS[active]!;

  return (
    <div className="pipeline" ref={root}>
      <p className="eyebrow">How a reply is built</p>
      <div className="pipe-track">
        <div className="pipe-line" />
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={`pipe-step ${i === active ? "on" : ""} ${i < active ? "done" : ""}`}
            onClick={() => setActive(i)}
          >
            <span className="pipe-num">{i + 1}</span>
            <strong>{s.title}</strong>
          </button>
        ))}
      </div>
      <p className="pipe-body">{step.body}</p>
      {active === 2 && documentCount === 0 && (
        <button type="button" className="btn primary sm" onClick={onAddKnowledge}>
          Add a document
        </button>
      )}
    </div>
  );
}
