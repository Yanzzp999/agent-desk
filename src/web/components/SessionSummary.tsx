import { Activity, AlertTriangle, CheckCircle2, Clock3 } from "lucide-react";

import type { SessionSummary as SessionSummaryValue } from "../api/types";
import { EmptyState, formatDateTime, formatPercent, StatusBadge } from "./ui";

interface SessionSummaryProps {
  sessions: SessionSummaryValue[];
}

export function SessionSummary({ sessions }: SessionSummaryProps) {
  return (
    <section className="panel session-band" aria-label="Recent session summary">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Recent sessions</p>
          <h2>Subagent history</h2>
        </div>
        {sessions.length > 0 && <span className="section-count">{sessions.length} recent</span>}
      </div>

      <div className="panel-body">
        {sessions.length === 0 ? (
          <EmptyState title="No recent sessions">
            Dispatch a task to create a session summary with Codex worker progress.
          </EmptyState>
        ) : (
          <div className="session-list">
            {sessions.map((session) => {
              const progress = formatPercent(session.agents.succeeded, session.agents.total);

              return (
                <article key={session.sessionId} className="session-item">
                  <div className="session-title-row">
                    <strong>{session.taskTitle}</strong>
                    <StatusBadge status={session.status} />
                  </div>
                  <p className="session-id">{session.sessionId}</p>
                  <div className="session-progress-row">
                    <span className="progress-track" aria-label={`${progress}% agents succeeded`}>
                      <span className="progress-fill" style={{ width: `${progress}%` }} />
                    </span>
                    <span>{progress}%</span>
                  </div>
                  <div className="session-meta">
                    <span><Clock3 aria-hidden="true" size={13} />{formatDateTime(session.startedAt)}</span>
                    <span><Activity aria-hidden="true" size={13} />{session.model} · {session.reasoning} · {session.serviceTier}</span>
                    <span><CheckCircle2 aria-hidden="true" size={13} />{session.agents.succeeded}/{session.agents.total}</span>
                  </div>
                  {session.lastError && (
                    <div className="session-warning">
                      <AlertTriangle aria-hidden="true" size={13} />
                      <span>{session.lastError}</span>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
