import { FormEvent, useState } from "react";
import { useChat } from "../hooks/useChat";
import type { ConnectionProfile } from "../types";

type ChatPanelProps = {
  profile: ConnectionProfile | undefined;
};

export function ChatPanel({ profile }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const { messages, timeline, isSending, hasInterruptedMessages, sendMessage, clearConversation } =
    useChat(profile);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await sendMessage(draft);
    setDraft("");
  };

  return (
    <section className="panel chat-panel">
      <div className="panel-header">
        <h2>Chat</h2>
        <button type="button" onClick={clearConversation}>
          Clear
        </button>
      </div>

      <p className="subtle-text">
        Target: <strong>{profile?.baseUrl ?? "No profile selected"}</strong>
      </p>

      {hasInterruptedMessages ? (
        <p className="warning-text">
          Recovered partial assistant output from an interrupted stream.
        </p>
      ) : null}

      <div className="timeline-panel">
        <h3>Tool and Stage Timeline</h3>
        {timeline.length === 0 ? (
          <p className="subtle-text">No timeline events yet.</p>
        ) : (
          <ul className="timeline-list">
            {timeline.map((event) => (
              <li key={event.id} className="timeline-item">
                <header>
                  <strong>
                    {event.kind}: {event.name}
                  </strong>
                  <span className={`status-pill ${event.status}`}>{event.status}</span>
                </header>
                {event.detail ? <p className="subtle-text">{event.detail}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="chat-log">
        {messages.length === 0 ? (
          <p className="subtle-text">No messages yet.</p>
        ) : (
          messages.map((message) => (
            <article
              key={message.id}
              className={message.role === "user" ? "chat-message user-message" : "chat-message assistant-message"}
            >
              <header>
                <strong>{message.role === "user" ? "You" : "Assistant"}</strong>
                <span className={`status-pill ${message.status}`}>{message.status}</span>
              </header>
              <pre>{message.content || (message.status === "streaming" ? "..." : "")}</pre>
              {message.error ? <p className="error-text">{message.error}</p> : null}
            </article>
          ))
        )}
      </div>

      <form className="chat-input-row" onSubmit={onSubmit}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Send a message to /message endpoint"
          disabled={!profile || isSending}
        />
        <button type="submit" disabled={!profile || isSending || !draft.trim()}>
          {isSending ? "Streaming..." : "Send"}
        </button>
      </form>
    </section>
  );
}
