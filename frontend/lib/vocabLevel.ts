export type VocabLevelId = "basico" | "intermedio" | "experto";

export type VocabLevelGate = {
  level: VocabLevelId;
  count: number;
  ok: boolean;
  rule: string;
  message: string;
};

function foldLevel(value: string) {
  return (value || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

export function evaluateVocabLevel(complexity: string, count: number): VocabLevelGate {
  const folded = foldLevel(complexity);
  const n = Math.max(0, count);

  if (folded.includes("inter")) {
    const ok = n >= 6 && n <= 10;
    return {
      level: "intermedio",
      count: n,
      ok,
      rule: "6 a 10 términos técnicos",
      message: ok
        ? `Nivel intermedio cubierto: ${n} términos (rango 6–10).`
        : `Nivel intermedio no cubierto: hay ${n} términos; se requieren de 6 a 10.`,
    };
  }

  if (folded.includes("avan") || folded.includes("expert")) {
    const ok = n >= 11;
    return {
      level: "experto",
      count: n,
      ok,
      rule: "más de 10 términos técnicos (11 o más)",
      message: ok
        ? `Nivel experto cubierto: ${n} términos (11 o más).`
        : `Nivel experto no cubierto: hay ${n} términos; se requieren 11 o más.`,
    };
  }

  const ok = n >= 5;
  return {
    level: "basico",
    count: n,
    ok,
    rule: "mínimo 5 términos técnicos",
    message: ok
      ? `Nivel básico cubierto: ${n} términos (mínimo 5).`
      : `Nivel básico no cubierto: hay ${n} términos; se requieren 5 o más.`,
  };
}
