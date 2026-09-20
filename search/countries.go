package search

// Country holds spoofing data for a nationality.
type Country struct {
	Code   string  `json:"code"`
	Name   string  `json:"name"`
	Flag   string  `json:"flag"`
	Lang   string  `json:"lang"`
	TZ     string  `json:"tz"`
	Lat    float64 `json:"lat"`
	Lng    float64 `json:"lng"`
	Locale string  `json:"locale"`
}

// Countries is the ordered list of supported nationalities.
var Countries = []Country{
	{"auto", "Auto (randomize)", "AUTO", "en-US,en;q=0.5", "UTC", 0, 0, "en-US"},
	{"us", "United States", "US", "en-US,en;q=0.9", "America/New_York", 38.8951, -77.0364, "en-US"},
	{"gb", "United Kingdom", "GB", "en-GB,en;q=0.9", "Europe/London", 51.5074, -0.1278, "en-GB"},
	{"de", "Germany", "DE", "de-DE,de;q=0.9,en;q=0.5", "Europe/Berlin", 52.5200, 13.4050, "de-DE"},
	{"fr", "France", "FR", "fr-FR,fr;q=0.9,en;q=0.5", "Europe/Paris", 48.8566, 2.3522, "fr-FR"},
	{"nl", "Netherlands", "NL", "nl-NL,nl;q=0.9,en;q=0.5", "Europe/Amsterdam", 52.3676, 4.9041, "nl-NL"},
	{"ch", "Switzerland", "CH", "de-CH,de;q=0.9,en;q=0.5", "Europe/Zurich", 46.9480, 7.4474, "de-CH"},
	{"se", "Sweden", "SE", "sv-SE,sv;q=0.9,en;q=0.5", "Europe/Stockholm", 59.3293, 18.0686, "sv-SE"},
	{"no", "Norway", "NO", "nb-NO,nb;q=0.9,en;q=0.5", "Europe/Oslo", 59.9139, 10.7522, "nb-NO"},
	{"is", "Iceland", "IS", "is-IS,is;q=0.9,en;q=0.5", "Atlantic/Reykjavik", 64.1466, -21.9426, "is-IS"},
	{"jp", "Japan", "JP", "ja-JP,ja;q=0.9,en;q=0.5", "Asia/Tokyo", 35.6762, 139.6503, "ja-JP"},
	{"kr", "South Korea", "KR", "ko-KR,ko;q=0.9,en;q=0.5", "Asia/Seoul", 37.5665, 126.9780, "ko-KR"},
	{"br", "Brazil", "BR", "pt-BR,pt;q=0.9,en;q=0.5", "America/Sao_Paulo", -15.7975, -47.8919, "pt-BR"},
	{"ca", "Canada", "CA", "en-CA,en;q=0.9,fr;q=0.5", "America/Toronto", 45.4215, -75.6972, "en-CA"},
	{"au", "Australia", "AU", "en-AU,en;q=0.9", "Australia/Sydney", -33.8688, 151.2093, "en-AU"},
	{"it", "Italy", "IT", "it-IT,it;q=0.9,en;q=0.5", "Europe/Rome", 41.9028, 12.4964, "it-IT"},
	{"es", "Spain", "ES", "es-ES,es;q=0.9,en;q=0.5", "Europe/Madrid", 40.4168, -3.7038, "es-ES"},
	{"pt", "Portugal", "PT", "pt-PT,pt;q=0.9,en;q=0.5", "Europe/Lisbon", 38.7223, -9.1393, "pt-PT"},
	{"in", "India", "IN", "hi-IN,hi;q=0.9,en;q=0.7", "Asia/Kolkata", 28.6139, 77.2090, "hi-IN"},
	{"ru", "Russia", "RU", "ru-RU,ru;q=0.9,en;q=0.5", "Europe/Moscow", 55.7558, 37.6173, "ru-RU"},
	{"mx", "Mexico", "MX", "es-MX,es;q=0.9,en;q=0.5", "America/Mexico_City", 19.4326, -99.1332, "es-MX"},
	{"ar", "Argentina", "AR", "es-AR,es;q=0.9,en;q=0.5", "America/Argentina/Buenos_Aires", -34.6037, -58.3816, "es-AR"},
	{"pl", "Poland", "PL", "pl-PL,pl;q=0.9,en;q=0.5", "Europe/Warsaw", 52.2297, 21.0122, "pl-PL"},
	{"sg", "Singapore", "SG", "en-SG,en;q=0.9", "Asia/Singapore", 1.3521, 103.8198, "en-SG"},
}

// FindCountry returns a country by code, or the auto entry.
func FindCountry(code string) Country {
	for _, c := range Countries {
		if c.Code == code {
			return c
		}
	}
	return Countries[0]
}
