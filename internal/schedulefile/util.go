package schedulefile

import (
	"math"
	"strconv"
	"strings"

	"github.com/vX8q/tga/internal/tableutil"
)

var driverDiacriticReplacer = strings.NewReplacer(
	"á", "a", "à", "a", "ä", "a", "â", "a", "ã", "a", "å", "a",
	"Á", "a", "À", "a", "Ä", "a", "Â", "a", "Ã", "a", "Å", "a",
	"é", "e", "è", "e", "ë", "e", "ê", "e",
	"É", "e", "È", "e", "Ë", "e", "Ê", "e",
	"í", "i", "ì", "i", "ï", "i", "î", "i",
	"Í", "i", "Ì", "i", "Ï", "i", "Î", "i",
	"ó", "o", "ò", "o", "ö", "o", "ô", "o", "õ", "o",
	"Ó", "o", "Ò", "o", "Ö", "o", "Ô", "o", "Õ", "o",
	"ú", "u", "ù", "u", "ü", "u", "û", "u",
	"Ú", "u", "Ù", "u", "Ü", "u", "Û", "u",
	"ñ", "n", "Ñ", "n",
)

// canonicalDriverKey возвращает канонический ключ для имени пилота
// для агрегирующих структур (standings/stats), чтобы не плодить
// дубликаты из‑за различий только в регистре, пробелах, точках и служебных суффиксах.
func canonicalDriverKey(name string) string {
	s := strings.TrimSpace(name)
	if s == "" {
		return ""
	}

	// Убираем служебные суффиксы вроде "(i)", "(R)".
	for _, suf := range []string{"(i)", "(I)", "(r)", "(R)"} {
		if strings.HasSuffix(s, suf) {
			s = strings.TrimSpace(s[:len(s)-len(suf)])
		}
	}

	// Убираем суффикс "(NN races)" / "(NN race)".
	if idx := strings.LastIndex(s, "("); idx != -1 && strings.HasSuffix(s, ")") {
		inner := strings.TrimSpace(s[idx+1 : len(s)-1])
		parts := strings.Fields(inner)
		if len(parts) == 2 {
			numPart := parts[0]
			word := strings.ToLower(parts[1])
			allDigits := true
			for _, c := range numPart {
				if c < '0' || c > '9' {
					allDigits = false
					break
				}
			}
			if allDigits && strings.HasPrefix(word, "race") {
				s = strings.TrimSpace(s[:idx])
			}
		}
	}

	// Убираем точки (Ricky Stenhouse Jr. → Ricky Stenhouse Jr).
	s = strings.ReplaceAll(s, ".", "")

	// Убираем диакритики в самых распространённых случаях (Suárez → Suarez и т.п.).
	s = driverDiacriticReplacer.Replace(s)

	// Нормализуем пробелы.
	s = strings.Join(strings.Fields(s), " ")
	// Collapse spaced initials: "A. J." / "A J" -> "AJ"
	// (needed to treat "AJ Allmendinger" and "A. J. Allmendinger" as the same person).
	sLower := strings.ToLower(s)
	sLower = strings.ReplaceAll(sLower, "a j ", "aj ")
	if strings.HasSuffix(sLower, " a j") {
		sLower = strings.TrimSuffix(sLower, " a j") + " aj"
	} else if sLower == "a j" {
		sLower = "aj"
	}
	return sLower
}

// preferredDriverName normalizes a few known variants so that merged rows
// keep a consistent display name (instead of picking an arbitrary variant).
func preferredDriverName(name string) string {
	raw := strings.TrimSpace(name)
	if raw == "" {
		return raw
	}
	// Compare using the same canonical-ish normalization, but keep display exact casing/punctuation.
	tmp := strings.ToLower(raw)
	tmp = strings.ReplaceAll(tmp, ".", "")
	tmp = driverDiacriticReplacer.Replace(tmp)
	tmp = strings.Join(strings.Fields(tmp), " ")
	tmp = strings.ReplaceAll(tmp, "a j ", "aj ")
	if strings.HasSuffix(tmp, " a j") {
		tmp = strings.TrimSuffix(tmp, " a j") + " aj"
	} else if tmp == "a j" {
		tmp = "aj"
	}
	if tmp == "aj allmendinger" {
		return "A. J. Allmendinger"
	}
	return raw
}

func colIndex(headers []string, name string) int {
	return tableutil.ColIndex(headers, name)
}

func firstColIndex(headers []string, names ...string) int {
	return tableutil.FirstColIndex(headers, names...)
}

func valueAt(row []string, col int) string {
	if col < 0 || col >= len(row) {
		return ""
	}
	return strings.TrimSpace(row[col])
}

// isAllDigits возвращает true, если строка состоит только из цифр 0–9 и не пуста.
func isAllDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

func atoiSafe(s string) int {
	s = strings.TrimSpace(s)
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0
	}
	return n
}

func roundTo(x float64, prec int) float64 {
	if prec < 0 {
		return x
	}
	p := math.Pow10(prec)
	return math.Round(x*p) / p
}

func divSafe(num, den float64) float64 {
	if den == 0 {
		return 0
	}
	return num / den
}

func itoa(n int) string {
	return strconv.Itoa(n)
}

func atoi(s string) int {
	n := 0
	for _, c := range s {
		if c >= '0' && c <= '9' {
			n = n*10 + int(c-'0')
		}
	}
	return n
}

