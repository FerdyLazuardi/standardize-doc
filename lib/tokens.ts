// Token counting using js-tiktoken (cl100k_base, same as A-Pedi backend).
import { Tiktoken } from "js-tiktoken/lite";
import cl100kBase from "js-tiktoken/ranks/cl100k_base";

let _enc: Tiktoken | null = null;

function getEncoder(): Tiktoken {
  if (!_enc) _enc = new Tiktoken(cl100kBase);
  return _enc;
}

export function countTokens(text: string): number {
  if (!text) return 0;
  return getEncoder().encode(text).length;
}
