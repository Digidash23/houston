//! The `lang` a loopback page declares.

/// The page's `lang`: one of the app's locales, since its copy comes from the
/// webview's translations. Anything else is English, the sign-in pages' copy.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(from = "String")]
pub enum PageLang {
    En,
    Es,
    Pt,
}

impl From<String> for PageLang {
    fn from(tag: String) -> Self {
        match tag.as_str() {
            "es" => Self::Es,
            "pt" => Self::Pt,
            _ => Self::En,
        }
    }
}

impl PageLang {
    pub(super) fn tag(self) -> &'static str {
        match self {
            Self::En => "en",
            Self::Es => "es",
            Self::Pt => "pt",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_app_locales_are_kept() {
        let parse = |json: &str| serde_json::from_str::<PageLang>(json).expect("a string");
        assert_eq!(parse(r#""es""#), PageLang::Es);
        assert_eq!(parse(r#""pt""#), PageLang::Pt);
        assert_eq!(parse(r#""en""#), PageLang::En);
        assert_eq!(parse(r#""fr""#), PageLang::En);
        assert_eq!(parse(r#""es-MX""#), PageLang::En);
    }
}
