import { log } from "./logger";

/**
 * Временная почта через mail.tm API (рабочий аналог temp-mail.org).
 * Документация: https://docs.mail.tm
 *
 * Флоу: получить домен → создать аккаунт → токен → ждать письмо →
 * достать код подтверждения или ссылку активации.
 */

const API = "https://api.mail.tm";

interface Domain {
  id: string;
  domain: string;
  isActive: boolean;
  isPrivate: boolean;
}

interface MailAccount {
  id: string;
  address: string;
}

interface MailToken {
  token: string;
}

interface MailMessage {
  id: string;
  from: { address: string; name: string };
  subject: string;
  intro: string;
  seen: boolean;
  createdAt: string;
}

interface MessageFull extends MailMessage {
  text?: string;
  html?: string[];
}

async function api<T>(path: string, init?: RequestInit & { token?: string }): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string>),
  };
  if (init?.token) headers.Authorization = `Bearer ${init.token}`;

  const res = await fetch(`${API}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // тело может содержать адрес ящика — обрезаем, чтобы не светить в лог
    throw new Error(`mail.tm ${init?.method ?? "GET"} ${path} → ${res.status} ${body.slice(0, 120)}`);
  }
  return (await res.json()) as T;
}

function randomPassword(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export interface TempMailbox {
  address: string;
  password: string;
  token: string;
}

/** Создаёт свежий временный ящик. */
export async function createMailbox(): Promise<TempMailbox> {
  const domains = await api<{ "hydra:member": Domain[] }>("/domains?page=1");
  const domain = domains["hydra:member"].find((d) => d.isActive && !d.isPrivate);
  if (!domain) throw new Error("mail.tm: нет доступных доменов");

  const local = `unigen${Date.now().toString(36)}${Math.floor(Math.random() * 10000)}`;
  const address = `${local}@${domain.domain}`;
  const password = randomPassword();

  // пароль ящика в логи не пишем — только адрес
  log.debug(`tempmail: создаю ящик ${address}`);
  await api<MailAccount>("/accounts", { method: "POST", body: JSON.stringify({ address, password }) });

  const tokenRes = await api<MailToken>("/token", {
    method: "POST",
    body: JSON.stringify({ address, password }),
  });

  return { address, password, token: tokenRes.token };
}

/** Ждёт первое входящее письмо (секунд по умолчанию — 90). */
export async function waitForMessage(token: string, timeoutSec = 90, pollMs = 3000): Promise<MessageFull> {
  const deadline = Date.now() + timeoutSec * 1000;

  while (Date.now() < deadline) {
    const list = await api<{ "hydra:member": MailMessage[] }>("/messages?page=1", { token });
    const fresh = list["hydra:member"].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (fresh) {
      const full = await api<MessageFull>(`/messages/${fresh.id}`, { token });
      // ждём, пока письмо хоть как-то отрендерится
      if (full.html?.length || full.text) return full;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error("mail.tm: письмо не пришло за отведённое время");
}

/** Достаёт 4–8-значный код подтверждения из письма. */
export function extractCode(message: MessageFull): string | null {
  const haystack = [message.subject, message.intro, message.text, ...(message.html ?? [])].filter(Boolean).join("\n");
  const plain = haystack.replace(/<[^>]+>/g, " ");
  const match = plain.match(/\b(\d{4,8})\b/);
  return match ? match[1] : null;
}

/** Достаёт ссылку активации/подтверждения из письма. */
export function extractLink(message: MessageFull): string | null {
  const haystack = [message.text, ...(message.html ?? [])].filter(Boolean).join("\n");
  const match = haystack.match(/https?:\/\/[^\s"'<>]+/);
  if (!match) return null;
  // выкидываем трекеры вида https://mail.tm/...
  const link = match[0].replace(/&amp;/g, "&");
  return link;
}
