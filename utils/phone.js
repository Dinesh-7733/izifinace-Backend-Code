exports.isE164 = s => /^\+\d{9,15}$/.test(String(s || "").trim());

exports.normalizeToE164 = (raw, defaultCountry = "KE") => {
  if (!raw) return null;
  let s = String(raw).replace(/[^\d+0-9]/g, ""); // strip spaces, dashes, etc.
  if (s.startsWith("+")) return exports.isE164(s) ? s : null;

  // For Kenyan numbers
  if (defaultCountry === "KE") {
    if (s.startsWith("07")) s = "+254" + s.slice(1); // 0712345678 -> +254712345678
    else if (s.startsWith("7")) s = "+254" + s;      // 712345678 -> +254712345678
    else if (s.length === 9) s = "+254" + s;         // 712345678 -> +254712345678
    else if (s.length === 12 && s.startsWith("254")) s = "+" + s; // 254712345678 -> +254712345678
  }

  return exports.isE164(s) ? s : null;
};
