import { serverCopy } from "~/i18n/serverCopy";
import { readUiLocale } from "~/i18n";
import { uiText } from "../../i18n";
import type { StorageInspection } from "@t3tools/contracts";
import { Fragment, useState } from "react";

import { formatBytes } from "../../lib/formatBytes";
import { Tabs, TabsList, TabsTab } from "../ui/tabs";

const VISIBLE_ROWS = 5;
const PHASES: Record<string, string> = {
  get completed() {
    return uiText("Completed");
  },
  get planned() {
    return uiText("Pending approval");
  },
  get cancelled() {
    return uiText("Canceled");
  },
  get failed() {
    return uiText("Failed");
  },
  get queued() {
    return uiText("Queued.");
  },
  get started() {
    return uiText("In progress");
  },
};

/** Archives and cleanup records as one compact table: largest 5 first, the rest scroll inside the card. */
export function CleanupRecords({ data }: { readonly data: StorageInspection }) {
  const [tab, setTab] = useState<"archives" | "operations">(
    data.archives.length ? "archives" : "operations",
  );
  const [showAll, setShowAll] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const archives = data.archives.toSorted((a, b) => b.bytes - a.bytes);
  const operations = data.operations;
  const total = tab === "archives" ? archives.length : operations.length;
  const archiveBytes = archives.reduce((sum, a) => sum + a.bytes, 0);
  const restorable = archives.filter((a) => a.restorable).length;
  const select = (next: "archives" | "operations") => {
    setTab(next);
    setShowAll(false);
    setOpenId(null);
  };
  const toggle = (id: string) => setOpenId((current) => (current === id ? null : id));

  return (
    <section data-usage-card className="usage-clean-records">
      <div className="usage-records-head">
        <h3>{uiText("Archives and cleanup history")}</h3>
        <div className="ms-auto">
          <Tabs value={tab} onValueChange={(value) => select(value as "archives" | "operations")}>
            <TabsList size="sm" aria-label={uiText("Archives and cleanup history")}>
              <TabsTab value="archives">
                {uiText("Archives ")}
                {archives.length}
              </TabsTab>
              <TabsTab value="operations">
                {uiText("Cleanup history ")}
                {operations.length}
              </TabsTab>
            </TabsList>
          </Tabs>
        </div>
      </div>
      {tab === "archives" ? (
        <div className="usage-records-summary">
          <div>
            <b>
              {archives.length} {uiText(" more")}
            </b>
            {uiText("Archives ")}
          </div>
          <div>
            <b>{formatBytes(archiveBytes)}</b>
            {uiText("Used")}
          </div>
          <div>
            <b>
              {restorable} / {archives.length}
            </b>
            {uiText("Recoverable")}
          </div>
        </div>
      ) : null}
      {total === 0 ? (
        <p className="usage-records-empty">
          {tab === "archives" ? uiText("No archives yet") : uiText("No cleanup history yet")}
        </p>
      ) : (
        <div className="usage-records-scroll" data-all={showAll || undefined}>
          <table className="usage-records-table">
            <thead>
              <tr>
                <th aria-hidden="true" />
                <th>{uiText("Name")}</th>
                <th>{tab === "archives" ? uiText("From") : uiText("Type")}</th>
                <th className="usage-records-num">
                  {tab === "archives" ? uiText("Size") : uiText("Time")}
                </th>
                <th>{uiText("Status")}</th>
              </tr>
            </thead>
            <tbody>
              {tab === "archives"
                ? (showAll ? archives : archives.slice(0, VISIBLE_ROWS)).map((a) => (
                    <Fragment key={a.id}>
                      <tr
                        data-open={openId === a.id || undefined}
                        tabIndex={0}
                        aria-expanded={openId === a.id}
                        onClick={() => toggle(a.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            toggle(a.id);
                          }
                        }}
                      >
                        <td>
                          <i className="usage-records-chevron" />
                        </td>
                        <td className="usage-records-name">
                          <div>{a.name}</div>
                        </td>
                        <td className="usage-records-muted">{a.source}</td>
                        <td className="usage-records-num">{formatBytes(a.bytes)}</td>
                        <td>
                          <span className="usage-records-state" data-ok={a.restorable || undefined}>
                            {!a.online
                              ? uiText("Offline")
                              : a.restorable
                                ? uiText("Recoverable")
                                : uiText("Unrecoverable")}
                          </span>
                        </td>
                      </tr>
                      {openId === a.id ? (
                        <tr className="usage-records-detail">
                          <td />
                          <td colSpan={4}>
                            <p>{a.path}</p>
                            <p>
                              {a.online
                                ? uiText("Archive disk connected")
                                : uiText("Archive disk disconnected")}{" "}
                              ·{" "}
                              {a.restorable
                                ? uiText(
                                    "Restore to a new folder and verify each file. Existing files stay in place.",
                                  )
                                : uiText("This archive requires manual recovery")}
                            </p>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))
                : (showAll ? operations : operations.slice(0, VISIBLE_ROWS)).map((op) => (
                    <Fragment key={op.id}>
                      <tr
                        data-open={openId === op.id || undefined}
                        tabIndex={0}
                        aria-expanded={openId === op.id}
                        onClick={() => toggle(op.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            toggle(op.id);
                          }
                        }}
                      >
                        <td>
                          <i className="usage-records-chevron" />
                        </td>
                        <td className="usage-records-name">
                          <div>{op.source ?? op.archive ?? op.destination ?? op.id}</div>
                        </td>
                        <td className="usage-records-muted">
                          {op.type === "restore" ? uiText("Restore") : uiText("Organize")}
                        </td>
                        <td className="usage-records-num usage-records-muted">
                          {formatOperationTime(op.createdAt)}
                        </td>
                        <td>
                          <span
                            className="usage-records-state"
                            data-ok={op.phase === "completed" || undefined}
                            data-bad={op.phase === "failed" || undefined}
                          >
                            {PHASES[op.phase] ?? uiText("Needs verification.")}
                          </span>
                        </td>
                      </tr>
                      {openId === op.id ? (
                        <tr className="usage-records-detail">
                          <td />
                          <td colSpan={4}>
                            <p>{op.createdAt}</p>
                            {op.destination ? (
                              <p>
                                {uiText("Destination:")}
                                {op.destination}
                              </p>
                            ) : null}
                            {op.error ? <p>{serverCopy(op.error)}</p> : null}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
            </tbody>
          </table>
        </div>
      )}
      {total > VISIBLE_ROWS ? (
        <button
          type="button"
          className="usage-records-more"
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll
            ? uiText("Collapse recommendation")
            : total === 1
              ? uiText("Show all {total} item", { total })
              : uiText("Show all {total} items", { total })}
        </button>
      ) : null}
    </section>
  );
}

function formatOperationTime(value: string | undefined) {
  if (!value) return uiText("Not recorded");
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleString(readUiLocale(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
