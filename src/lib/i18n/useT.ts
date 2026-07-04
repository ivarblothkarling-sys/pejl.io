import { translate, type Language } from "./strings";

export function useT(language: Language | string | undefined) {
  return (key: string) => translate(language, key);
}
