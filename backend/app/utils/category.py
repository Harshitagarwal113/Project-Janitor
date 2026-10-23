from typing import Dict, Set
from app.schemas.scan import FileCategory

CATEGORY_MAP: Dict[FileCategory, Set[str]] = {
    FileCategory.DOCUMENTS: {
        ".pdf", ".doc", ".docx", ".txt", ".rtf", ".odt",
        ".xls", ".xlsx", ".ods", ".ppt", ".pptx", ".odp",
        ".csv", ".tsv", ".md", ".markdown", ".epub",
        ".pages", ".numbers", ".key", ".tex",
    },
    FileCategory.IMAGES: {
        ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp",
        ".tiff", ".tif", ".svg", ".ico", ".heic", ".raw",
        ".psd", ".ai", ".eps", ".avif",
    },
    FileCategory.VIDEOS: {
        ".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv",
        ".webm", ".m4v", ".mpg", ".mpeg", ".3gp", ".ts", ".ogv",
    },
    FileCategory.AUDIO: {
        ".mp3", ".wav", ".aac", ".flac", ".ogg", ".m4a",
        ".wma", ".aiff", ".opus", ".alac", ".mid", ".midi",
    },
    FileCategory.ARCHIVES: {
        ".zip", ".tar", ".gz", ".tgz", ".bz2", ".tbz2",
        ".7z", ".rar", ".xz", ".iso", ".dmg", ".zst",
    },
    FileCategory.CODE: {
        ".py", ".js", ".jsx", ".ts", ".tsx", ".html", ".htm",
        ".css", ".scss", ".sass", ".json", ".xml", ".yaml", ".yml",
        ".c", ".cpp", ".cc", ".h", ".hpp", ".cs", ".java",
        ".go", ".rs", ".rb", ".php", ".sh", ".bash", ".bat",
        ".cmd", ".ps1", ".sql", ".r", ".swift", ".kt", ".lua",
    },
}

# Precompute lookup dictionary for O(1) matching
_EXTENSION_TO_CATEGORY: Dict[str, FileCategory] = {}
for category, extensions in CATEGORY_MAP.items():
    for ext in extensions:
        _EXTENSION_TO_CATEGORY[ext] = category


def classify_extension(extension: str) -> FileCategory:
    """Classify a file extension into one of the supported categories.

    The extension should include the leading dot and is case-insensitive.
    If no match is found, FileCategory.OTHER is returned.
    """
    normalized = extension.strip().lower()
    return _EXTENSION_TO_CATEGORY.get(normalized, FileCategory.OTHER)
