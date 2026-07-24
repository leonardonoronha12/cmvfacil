"use client";

export function digitsOnly(value: string) {
  return String(value ?? "").replace(/\D/g, "");
}

function clampDigits(value: string, max: number) {
  const d = digitsOnly(value);
  return d.length > max ? d.slice(0, max) : d;
}

export function maskCpf(value: string) {
  const d = clampDigits(value, 11);
  const p1 = d.slice(0, 3);
  const p2 = d.slice(3, 6);
  const p3 = d.slice(6, 9);
  const p4 = d.slice(9, 11);
  if (d.length <= 3) return p1;
  if (d.length <= 6) return `${p1}.${p2}`;
  if (d.length <= 9) return `${p1}.${p2}.${p3}`;
  return `${p1}.${p2}.${p3}-${p4}`;
}

export function maskCnpj(value: string) {
  const d = clampDigits(value, 14);
  const p1 = d.slice(0, 2);
  const p2 = d.slice(2, 5);
  const p3 = d.slice(5, 8);
  const p4 = d.slice(8, 12);
  const p5 = d.slice(12, 14);
  if (d.length <= 2) return p1;
  if (d.length <= 5) return `${p1}.${p2}`;
  if (d.length <= 8) return `${p1}.${p2}.${p3}`;
  if (d.length <= 12) return `${p1}.${p2}.${p3}/${p4}`;
  return `${p1}.${p2}.${p3}/${p4}-${p5}`;
}

export function maskPhoneBR(value: string) {
  let d = digitsOnly(value);
  if (d.startsWith("55") && d.length > 11) d = d.slice(2);
  d = d.length > 11 ? d.slice(0, 11) : d;
  const area = d.slice(0, 2);
  const rest = d.slice(2);
  if (!rest) return area ? `(${area}` : "";
  const isMobile = rest.length > 8;
  const p1 = isMobile ? rest.slice(0, 5) : rest.slice(0, 4);
  const p2 = isMobile ? rest.slice(5, 9) : rest.slice(4, 8);
  const areaPart = area.length === 2 ? `(${area}) ` : `(${area}`;
  if (rest.length <= (isMobile ? 5 : 4)) return `${areaPart}${p1}`;
  return `${areaPart}${p1}-${p2}`;
}

