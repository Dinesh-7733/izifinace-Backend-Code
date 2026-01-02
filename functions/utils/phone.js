// ✅ E.164 validator
exports.isE164 = (phone) => {
  return /^\+[1-9]\d{1,14}$/.test(phone);
};

exports.normalizeToE164 = (raw, defaultCountry = "KE") => {
  if (!raw) return null;

  let s = String(raw)
    .replace(/[^\d+]/g, "")
    .replace(/\u200B/g, "")
    .replace(/\u00A0/g, "");

  if (!s) return null;

  // Already E164
  if (s.startsWith("+") && exports.isE164(s)) {
    return s;
  }

  // 🇰🇪 Kenya rules
  if (defaultCountry === "KE") {

    if (s.startsWith("07")) {
      s = "+254" + s.slice(1);
      return exports.isE164(s) ? s : null;
    }

    if (s.length === 9 && s.startsWith("7")) {
      s = "+254" + s;
      return exports.isE164(s) ? s : null;
    }

    if (s.length === 10 && s.startsWith("0")) {
      s = "+254" + s.slice(1);
      return exports.isE164(s) ? s : null;
    }

    if (s.length === 12 && s.startsWith("254")) {
      s = "+" + s;
      return exports.isE164(s) ? s : null;
    }
  }

  return null;
};
