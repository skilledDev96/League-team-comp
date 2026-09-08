/**
 * Errors the browser hit, written where an admin can read them.
 *
 * "Something went wrong in the draft" the next morning had nothing to go on
 * (8 Sep 2026): the console was gone with the tab. Every uncaught error now
 * lands in `clientErrors` with the page it happened on and who was signed in,
 * beside the draft log. Capped per session so a render loop cannot write a
 * thousand documents, and deduplicated so one bug is one row.
 */
import { ErrorHandler, Injectable } from '@angular/core';
import { doc, setDoc } from 'firebase/firestore';
import { getAuthInstance, getDb } from './firebase';

const MAX_PER_SESSION = 20;
const seen = new Set<string>();

export interface ClientError {
  id: string;
  at: string;
  by: string;
  url: string;
  message: string;
  stack?: string;
  userAgent: string;
}

export async function reportClientError(error: unknown): Promise<void> {
  const db = getDb();
  if (!db || seen.size >= MAX_PER_SESSION) return;
  const message = error instanceof Error ? error.message : String(error);
  const key = message.slice(0, 200);
  if (seen.has(key)) return;
  seen.add(key);
  const id = `err-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const entry: ClientError = {
    id,
    at: new Date().toISOString(),
    by: getAuthInstance()?.currentUser?.email ?? 'anonymous',
    url: location.pathname + location.search,
    message: message.slice(0, 1000),
    ...(error instanceof Error && error.stack ? { stack: error.stack.slice(0, 2000) } : {}),
    userAgent: navigator.userAgent.slice(0, 200)
  };
  try {
    const { id: _id, ...rest } = entry;
    await setDoc(doc(db, 'clientErrors', id), rest);
  } catch {
    // Reporting must never be the thing that breaks.
  }
}

@Injectable()
export class ReportingErrorHandler implements ErrorHandler {
  handleError(error: unknown): void {
    console.error(error);
    void reportClientError(error);
  }
}
