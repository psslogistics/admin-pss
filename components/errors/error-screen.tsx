"use client";

import { useRouter } from "next/navigation";

type ErrorScreenProps = {
  statusCode: number;
  title?: string;
  description?: string;
  requestId?: string;
  retry?: () => void;
  homeUrl?: string;
};

type StatusMeta = { title: string; description: string; category: string };

const STATUS_META: Record<number, StatusMeta> = {
  400: { title: "Bad request", description: "The request could not be understood by this service.", category: "CLIENT FAILURE" },
  401: { title: "Authentication required", description: "Your session is missing, expired, or no longer valid.", category: "ACCESS FAILURE" },
  403: { title: "Access denied", description: "This resource is not available for your current account.", category: "ACCESS FAILURE" },
  404: { title: "Page not found", description: "The route exists somewhere in the system, but not here.", category: "ROUTE FAILURE" },
  408: { title: "Request timed out", description: "The service took too long to receive a complete request.", category: "NETWORK FAILURE" },
  409: { title: "Request conflict", description: "This action conflicts with the current state of the resource.", category: "CLIENT FAILURE" },
  410: { title: "No longer available", description: "This resource has been permanently removed.", category: "ROUTE FAILURE" },
  413: { title: "Payload too large", description: "The submitted data is larger than this service allows.", category: "CLIENT FAILURE" },
  429: { title: "Too many requests", description: "Please pause briefly before trying this again.", category: "RATE LIMIT" },
  500: { title: "Internal failure", description: "The service encountered an unexpected condition.", category: "SERVER FAILURE" },
  501: { title: "Not implemented", description: "This service does not support that capability yet.", category: "SERVER FAILURE" },
  502: { title: "Bad gateway", description: "An upstream service returned an invalid response.", category: "UPSTREAM FAILURE" },
  503: { title: "Service unavailable", description: "The service is temporarily unable to handle this request.", category: "SERVER FAILURE" },
  504: { title: "Gateway timeout", description: "An upstream service did not respond in time.", category: "UPSTREAM FAILURE" },
  505: { title: "HTTP version unsupported", description: "The requested HTTP protocol version is not supported.", category: "PROTOCOL FAILURE" },
};

const HOME_URL = "https://admin.psslogisitics.in";

export function ErrorScreen({ statusCode, title, description, requestId, retry, homeUrl = HOME_URL }: ErrorScreenProps) {
  const router = useRouter();
  const meta = STATUS_META[statusCode] ?? (statusCode >= 500
    ? { title: "Server failure", description: "Something went wrong on our side.", category: "SERVER FAILURE" }
    : { title: "Request failed", description: "The service could not complete this request.", category: "CLIENT FAILURE" });

  return (
    <main style={{ minHeight: "100svh", background: "#f1eee7", color: "#111111", display: "grid", placeItems: "center", padding: "clamp(24px, 6vw, 88px)", fontFamily: "Arial Narrow, Helvetica Neue, Arial, sans-serif" }}>
      <section role="alert" style={{ width: "min(100%, 1120px)", border: "3px solid #111111", background: "#f8f6f0", boxShadow: "14px 14px 0 #d8402f", position: "relative", overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 20, borderBottom: "3px solid #111111", padding: "14px 18px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11, letterSpacing: "0.12em", fontWeight: 800 }}>
          <span>PSS / SYSTEM RESPONSE</span><span>{meta.category}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(220px, .6fr)", gap: 0 }}>
          <div style={{ padding: "clamp(28px, 7vw, 86px) clamp(22px, 6vw, 72px)", borderRight: "3px solid #111111" }}>
            <div aria-hidden="true" style={{ color: "#d8402f", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, fontWeight: 800, letterSpacing: "0.16em" }}>STATUS CODE</div>
            <div style={{ fontSize: "clamp(110px, 22vw, 300px)", lineHeight: ".78", letterSpacing: "-.09em", fontWeight: 900, margin: "34px 0 30px", color: "#111111" }}>{statusCode}</div>
            <h1 style={{ margin: 0, maxWidth: 650, fontSize: "clamp(30px, 5vw, 72px)", lineHeight: ".95", letterSpacing: "-.055em", textTransform: "uppercase" }}>{title ?? meta.title}</h1>
            <p style={{ maxWidth: 520, margin: "22px 0 0", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13, lineHeight: 1.7 }}>{description ?? meta.description}</p>
          </div>
          <aside style={{ background: "#111111", color: "#f8f6f0", padding: "clamp(24px, 4vw, 48px)", display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: 280 }}>
            <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11, lineHeight: 1.7, letterSpacing: ".08em" }}>
              <div style={{ color: "#d8402f", fontWeight: 800 }}>DIAGNOSTIC</div>
              <div style={{ marginTop: 18 }}>REQUEST INTERRUPTED</div>
              <div>SAFE RESPONSE MODE: ON</div>
              {requestId ? <div style={{ marginTop: 18, color: "#c8c3b8" }}>REF: {requestId}</div> : null}
            </div>
            <div style={{ display: "grid", gap: 10, marginTop: 40 }}>
              {retry ? <button type="button" onClick={retry} style={{ cursor: "pointer", border: "2px solid #f8f6f0", background: "#f8f6f0", color: "#111111", padding: "13px 14px", fontWeight: 900, textTransform: "uppercase", letterSpacing: ".05em" }}>Try again</button> : null}
              <button type="button" onClick={() => { if (window.history.length > 1) router.back(); else window.location.assign(homeUrl); }} style={{ cursor: "pointer", border: "2px solid #f8f6f0", background: "transparent", color: "#f8f6f0", padding: "13px 14px", fontWeight: 900, textTransform: "uppercase", letterSpacing: ".05em" }}>Go back</button>
              <a href={homeUrl} style={{ border: "2px solid #d8402f", background: "#d8402f", color: "#111111", padding: "13px 14px", fontWeight: 900, textTransform: "uppercase", letterSpacing: ".05em", textDecoration: "none", textAlign: "center" }}>Go to home</a>
            </div>
          </aside>
        </div>
        <div style={{ borderTop: "3px solid #111111", padding: "12px 18px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 10, letterSpacing: ".1em", fontWeight: 800 }}>NO STACK TRACE EXPOSED / TECHNICAL DETAILS LOGGED SERVER-SIDE</div>
      </section>
      <style>{`@media (max-width: 700px) { section > div:nth-child(2) { grid-template-columns: 1fr !important; } section > div:nth-child(2) > div:first-child { border-right: 0 !important; border-bottom: 3px solid #111111; } }`}</style>
    </main>
  );
}
