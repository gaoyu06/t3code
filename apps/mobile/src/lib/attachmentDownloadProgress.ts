import { useSyncExternalStore } from "react";

/** A download quicker than this finishes without a progress notice. */
const NOTICE_DELAY_MS = 300;
const UPDATE_INTERVAL_MS = 100;

export interface AttachmentDownloadActivity {
  readonly id: number;
  readonly name: string;
  readonly bytesWritten: number;
  /** Null until the response declares its length; T3 Connect relays may omit it. */
  readonly totalBytes: number | null;
  readonly cancel: () => void;
}

let nextId = 1;
let visible: readonly AttachmentDownloadActivity[] = [];
const listeners = new Set<() => void>();

function publish(next: readonly AttachmentDownloadActivity[]) {
  visible = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The newest download still running past the notice delay, if any. */
export function currentAttachmentDownload(): AttachmentDownloadActivity | null {
  return visible.at(-1) ?? null;
}

export function useAttachmentDownloadActivity(): AttachmentDownloadActivity | null {
  return useSyncExternalStore(subscribe, currentAttachmentDownload);
}

/** Tracks one download for the progress notice until `end` runs. */
export function beginAttachmentDownload(name: string, cancel: () => void) {
  const id = nextId++;
  let activity: AttachmentDownloadActivity = {
    id,
    name,
    bytesWritten: 0,
    totalBytes: null,
    cancel,
  };
  let shown = false;
  let ended = false;
  let lastPublished = 0;
  const show = () => {
    shown = true;
    lastPublished = Date.now();
    publish([...visible, activity]);
  };
  const timer = setTimeout(show, NOTICE_DELAY_MS);
  return {
    update(bytesWritten: number, totalBytes: number) {
      if (ended) return;
      activity = { ...activity, bytesWritten, totalBytes: totalBytes > 0 ? totalBytes : null };
      const now = Date.now();
      if (!shown || now - lastPublished < UPDATE_INTERVAL_MS) return;
      lastPublished = now;
      publish(visible.map((entry) => (entry.id === id ? activity : entry)));
    },
    end() {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      if (shown) publish(visible.filter((entry) => entry.id !== id));
    },
  };
}
