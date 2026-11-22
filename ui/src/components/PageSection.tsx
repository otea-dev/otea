import type { ReactNode } from 'react';

// One section of a settings-like page: its name (and a quiet line under it) in the margin, its
// body beside it, a hairline above. On a narrow page (the phone, or beside a sheet) the name goes
// above the body (the container query of projects.css). `stack` lays the body's lines one under
// the other, as the preference groups do.
type PageSectionProps = {
  name: string;
  sub?: string;
  id?: string;
  stack?: boolean;
  children: ReactNode;
};

export function PageSection({ name, sub, id, stack = false, children }: PageSectionProps) {
  return (
    <section className="pj-sec" id={id}>
      <div className="pj-sec-label">
        <h2>{name}</h2>
        {sub ? <span className="margin-label">{sub}</span> : null}
      </div>
      <div className="pj-sec-body">
        {stack ? <div className="pj-stack">{children}</div> : children}
      </div>
    </section>
  );
}
