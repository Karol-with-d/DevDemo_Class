"""Technical vocabulary and filler words (muletillas) from a Whisper transcript.

Spanish NER rarely tags framework names, so tokens are classified against
Python/JS glossaries after spaCy lemmatizes the text. Missing spaCy or the
Spanish model must not break transcription.
"""

from __future__ import annotations

import re
import unicodedata
from collections import Counter

_nlp = None
_nlp_failed = False

# Display name -> aliases that Whisper/spaCy may produce in Spanish interviews.
_PYTHON_TERMS = {
    "python": ("python", "piton", "pitón"),
    "django": ("django",),
    "flask": ("flask",),
    "fastapi": ("fastapi", "fast api"),
    "pandas": ("pandas",),
    "numpy": ("numpy", "num py"),
    "pytest": ("pytest", "unittest"),
    "pip": ("pip",),
    "venv": ("venv", "virtualenv", "entorno virtual"),
    "clase": ("clase", "class"),
    "función": ("funcion", "función", "def", "function"),
    "método": ("metodo", "método", "method"),
    "decorador": ("decorador", "decorator"),
    "generador": ("generador", "generator", "yield"),
    "lambda": ("lambda",),
    "lista": ("lista", "list"),
    "tupla": ("tupla", "tuple"),
    "diccionario": ("diccionario", "dict", "hashmap"),
    "conjunto": ("conjunto", "set"),
    "comprension": ("comprension", "comprensión", "comprehension"),
    "async": ("async", "asyncio", "await"),
    "hilo": ("hilo", "thread", "threading"),
    "proceso": ("proceso", "multiprocessing"),
    "excepción": ("excepcion", "excepción", "exception", "try", "except"),
    "herencia": ("herencia", "inheritance"),
    "polimorfismo": ("polimorfismo", "polymorphism"),
    "encapsulamiento": ("encapsulamiento", "encapsulation"),
    "objeto": ("objeto", "object", "instancia"),
    "constructor": ("constructor", "init", "__init__"),
    "módulo": ("modulo", "módulo", "module"),
    "paquete": ("paquete", "package"),
    "api": ("api", "endpoint", "rest"),
    "json": ("json",),
    "sql": ("sql", "consulta"),
    "orm": ("orm", "sqlalchemy"),
    "websocket": ("websocket", "web socket"),
    "git": ("git", "commit", "branch", "merge"),
    "docker": ("docker", "contenedor"),
    "algoritmo": ("algoritmo", "algorithm"),
    "recursión": ("recursion", "recursión", "recursividad"),
    "complejidad": ("complejidad", "big o", "o de n"),
    "arreglo": ("arreglo", "array"),
    "string": ("string", "cadena"),
    "booleano": ("booleano", "boolean", "bool"),
    "none": ("none", "null"),
    "type hint": ("type hint", "typing", "anotacion", "anotación"),
    "pydantic": ("pydantic",),
    "uvicorn": ("uvicorn",),
}

_JS_TERMS = {
    "javascript": ("javascript", "java script", "js"),
    "typescript": ("typescript", "type script", "ts"),
    "node": ("node", "nodejs", "node.js"),
    "react": ("react", "reactjs"),
    "next.js": ("next", "nextjs", "next.js"),
    "vue": ("vue", "vuejs"),
    "angular": ("angular",),
    "html": ("html",),
    "css": ("css",),
    "dom": ("dom",),
    "promesa": ("promesa", "promise", "then", "catch"),
    "async": ("async", "await"),
    "callback": ("callback",),
    "closure": ("closure", "clausura"),
    "hoisting": ("hoisting",),
    "evento": ("evento", "event listener", "addEventListener"),
    "componente": ("componente", "component"),
    "props": ("props", "propiedades"),
    "estado": ("estado", "state", "usestate"),
    "hook": ("hook", "useeffect", "usestate"),
    "redux": ("redux",),
    "express": ("express",),
    "npm": ("npm", "yarn", "pnpm"),
    "webpack": ("webpack", "vite", "bundler"),
    "json": ("json",),
    "api": ("api", "fetch", "axios", "rest"),
    "arreglo": ("arreglo", "array", "map", "filter", "reduce"),
    "objeto": ("objeto", "object"),
    "arrow function": ("arrow", "arrow function", "funcion flecha", "función flecha"),
    "spread": ("spread", "destructuring", "destructuracion", "destructuración"),
    "event loop": ("event loop", "call stack"),
    "websocket": ("websocket", "web socket"),
    "jwt": ("jwt", "token"),
    "localstorage": ("localstorage", "sessionstorage"),
    "cors": ("cors",),
    "typescript interface": ("interface", "generic", "generics"),
    "undefined": ("undefined", "null", "nan"),
    "prototype": ("prototype", "prototipo", "this"),
    "módulo": ("modulo", "módulo", "import", "export", "require"),
    "git": ("git", "commit", "branch", "merge"),
    "docker": ("docker",),
    "algoritmo": ("algoritmo", "algorithm"),
    "complejidad": ("complejidad", "big o"),
    "jest": ("jest", "vitest", "cypress"),
    "tsx": ("tsx", "jsx"),
}

_GENERIC_TERMS = {
    "variable": ("variable",),
    "función": ("funcion", "función", "function"),
    "bucle": ("bucle", "loop", "for", "while"),
    "condicional": ("condicional", "if", "else"),
    "algoritmo": ("algoritmo",),
    "base de datos": ("base de datos", "database", "sql"),
    "api": ("api",),
    "json": ("json",),
    "git": ("git",),
    "http": ("http", "https", "get", "post", "put", "patch"),
    "autenticación": ("autenticacion", "autenticación", "login", "jwt"),
    "frontend": ("frontend", "front end"),
    "backend": ("backend", "back end"),
}

# Folded regex pattern -> canonical display label
_MULETILLA_PATTERNS = (
    (r"\bo sea\b", "o sea"),
    (r"\bla verdad\b", "la verdad"),
    (r"\bes que\b", "es que"),
    (r"\beh+\b", "eh"),
    (r"\beste+\b", "este"),
    (r"\bpues\b", "pues"),
    (r"\bbueno\b", "bueno"),
    (r"\bverdad\b", "verdad"),
    (r"\bdigamos\b", "digamos"),
    (r"\bbasicamente\b", "básicamente"),
    (r"\bmmm+\b", "mmm"),
)

SECTION_LABELS = {
    "javascript": "JavaScript / TypeScript",
    "react": "React / Next.js",
    "node": "Node.js / Express",
    "python": "Python",
    "fastapi": "FastAPI",
    "general": "General",
}

_TERM_SECTION = {}
_TERM_SECTION.update({key: "python" for key in _PYTHON_TERMS})
_TERM_SECTION.update({key: "javascript" for key in _JS_TERMS})
_TERM_SECTION.update({key: "general" for key in _GENERIC_TERMS})
_TERM_SECTION.update(
    {
        "fastapi": "fastapi",
        "pydantic": "fastapi",
        "uvicorn": "fastapi",
        "react": "react",
        "next.js": "react",
        "componente": "react",
        "props": "react",
        "estado": "react",
        "hook": "react",
        "redux": "react",
        "tsx": "react",
        "node": "node",
        "express": "node",
        "npm": "node",
        "jwt": "node",
        "cors": "node",
        "localstorage": "node",
    }
)


def _fold(text: str) -> str:
    nfkd = unicodedata.normalize("NFKD", text or "")
    return "".join(ch for ch in nfkd if not unicodedata.combining(ch)).lower()


def _glossary_for(technology: str) -> dict[str, tuple[str, ...]]:
    folded = _fold(technology)
    if "python" in folded or "piton" in folded or "fastapi" in folded:
        return {**_GENERIC_TERMS, **_PYTHON_TERMS}
    if (
        "javascript" in folded
        or "typescript" in folded
        or "type script" in folded
        or "react" in folded
        or "next" in folded
        or "node" in folded
        or "express" in folded
        or folded in {"js", "ts"}
    ):
        return {**_GENERIC_TERMS, **_JS_TERMS}
    return {**_GENERIC_TERMS, **_PYTHON_TERMS, **_JS_TERMS}


def _load_nlp():
    global _nlp, _nlp_failed
    if _nlp is not None or _nlp_failed:
        return _nlp
    try:
        import spacy

        try:
            _nlp = spacy.load("es_core_news_md", disable=["parser", "ner"])
        except OSError:
            try:
                _nlp = spacy.load("es_core_news_sm", disable=["parser", "ner"])
            except OSError:
                _nlp = spacy.blank("es")
                print("[WARN] spaCy sin modelo es_core_news_*. Usando tokenizador en blanco.")
    except Exception as exc:
        _nlp_failed = True
        print(f"[WARN] spaCy no disponible: {exc}")
        _nlp = None
    return _nlp


def _alias_index(glossary: dict[str, tuple[str, ...]]):
    index = []
    for canonical, aliases in glossary.items():
        for alias in aliases:
            folded = _fold(alias).strip()
            if folded:
                index.append((folded, canonical, alias))
    index.sort(key=lambda item: len(item[0]), reverse=True)
    return index


def extract_technical_terms(text: str, technology: str = ""):
    """Return unique {term, lemma, category} hits for the selected language."""
    spoken = " ".join((text or "").split())
    if not spoken:
        return []

    glossary = _glossary_for(technology)
    aliases = _alias_index(glossary)
    folded_text = _fold(spoken)
    hits = {}

    for folded_alias, canonical, alias in aliases:
        boundary = r"[a-z0-9_.]" if len(folded_alias) <= 2 else r"[a-z0-9_]"
        pattern = rf"(?<!{boundary})" + re.escape(folded_alias) + r"(?![a-z0-9_])"
        if re.search(pattern, folded_text):
            hits[canonical] = {
                "term": canonical,
                "lemma": alias,
                "category": "glossary",
                "section": _TERM_SECTION.get(canonical, "general"),
            }

    nlp = _load_nlp()
    if nlp is not None:
        try:
            doc = nlp(spoken)
        except Exception as exc:
            print(f"[WARN] spaCy no pudo analizar el texto: {exc}")
            doc = []
        alias_lookup = {_fold(alias): canonical for canonical, group in glossary.items() for alias in group}
        for token in doc:
            if token.is_space or token.is_punct or token.like_num:
                continue
            folded = _fold(token.lemma_ or token.text)
            canonical = alias_lookup.get(folded) or alias_lookup.get(_fold(token.text))
            if not canonical:
                continue
            pos = getattr(token, "pos_", "") or "X"
            category = pos if pos in {"NOUN", "PROPN", "VERB", "ADJ", "X"} else "glossary"
            if canonical in hits:
                if hits[canonical]["category"] == "glossary":
                    hits[canonical]["category"] = category
                continue
            hits[canonical] = {
                "term": canonical,
                "lemma": token.text,
                "category": category,
                "section": _TERM_SECTION.get(canonical, "general"),
            }

    return sorted(hits.values(), key=lambda item: item["term"])


def extract_muletillas(text: str) -> dict:
    """Count Spanish filler words (muletillas) in a verbatim transcript."""
    spoken = " ".join((text or "").split())
    if not spoken:
        return {
            "total": 0,
            "totalWords": 0,
            "ratioPct": 0.0,
            "breakdown": {},
            "items": [],
        }

    folded_text = _fold(spoken)
    counts = Counter()

    for pattern, label in _MULETILLA_PATTERNS:
        matches = re.findall(pattern, folded_text)
        if matches:
            counts[label] += len(matches)

    total_words = len(re.findall(r"\b\w+\b", folded_text))
    total_muletillas = sum(counts.values())
    ratio_pct = round((total_muletillas / total_words) * 100, 2) if total_words else 0.0

    return {
        "total": total_muletillas,
        "totalWords": total_words,
        "ratioPct": ratio_pct,
        "breakdown": dict(counts.most_common()),
        "items": [{"phrase": phrase, "count": count} for phrase, count in counts.most_common()],
    }
