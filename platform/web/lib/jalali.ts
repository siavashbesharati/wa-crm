const PERSIAN_MONTHS = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند"
] as const;

function div(a: number, b: number) {
  return Math.trunc(a / b);
}

export function gregorianToJalali(gy: number, gm: number, gd: number): [number, number, number] {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  gy -= gy <= 1600 ? 621 : 1600;
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    365 * gy +
    div(gy2 + 3, 4) -
    div(gy2 + 99, 100) +
    div(gy2 + 399, 400) -
    80 +
    gd +
    g_d_m[gm - 1];
  jy += 33 * div(days, 12053);
  days %= 12053;
  jy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) {
    jy += div(days - 1, 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + div(days, 31) : 7 + div(days - 186, 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy, jm, jd];
}

export function jalaliToGregorian(jy: number, jm: number, jd: number): [number, number, number] {
  let gy = jy <= 979 ? 621 : 1600;
  jy -= jy <= 979 ? 0 : 979;
  const days =
    365 * jy +
    div(jy, 33) * 8 +
    div((jy % 33) + 3, 4) +
    78 +
    jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  gy += 400 * div(days, 146097);
  let d = days % 146097;
  if (d >= 36525) {
    d--;
    gy += 100 * div(d, 36524);
    d %= 36524;
    if (d >= 365) d++;
  }
  gy += 4 * div(d, 1461);
  d %= 1461;
  if (d >= 366) {
    gy += div(d - 1, 365);
    d = (d - 1) % 365;
  }
  const gd = d + 1;
  const sal_a = [
    0,
    31,
    (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31
  ];
  let gm = 0;
  let day = gd;
  for (gm = 1; gm <= 12 && day > sal_a[gm]; gm += 1) {
    day -= sal_a[gm];
  }
  return [gy, gm, day];
}

export function isJalaliLeap(jy: number) {
  return (((jy + 12) % 33) % 4) === 1;
}

export function jalaliMonthLength(jy: number, jm: number) {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isJalaliLeap(jy) ? 30 : 29;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function isoToJalali(iso: string | null | undefined): [number, number, number] | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function jalaliToIso(jy: number, jm: number, jd: number): string {
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
  return `${gy}-${pad(gm)}-${pad(gd)}T12:00:00`;
}

export function formatJalali(iso: string | null | undefined): string {
  const parts = isoToJalali(iso);
  if (!parts) return "";
  const [jy, jm, jd] = parts;
  return `${jd} ${PERSIAN_MONTHS[jm - 1]} ${jy}`;
}

export function todayJalali(): [number, number, number] {
  const n = new Date();
  return gregorianToJalali(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

export { PERSIAN_MONTHS };
