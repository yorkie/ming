use serde::Serialize;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Line {
    kind: &'static str,
    text: String,
    old_number: Option<usize>,
    new_number: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Hunk {
    header: String,
    lines: Vec<Line>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileChange {
    path: String,
    old_path: String,
    status: &'static str,
    additions: usize,
    deletions: usize,
    hunks: Vec<Hunk>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Review {
    files: Vec<FileChange>,
    additions: usize,
    deletions: usize,
}

fn parse_range(header: &str, marker: char) -> Option<usize> {
    let start = header.find(marker)? + 1;
    let digits: String = header[start..].chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

fn analyze(patch: &str) -> Review {
    let mut files: Vec<FileChange> = Vec::new();
    let mut current: Option<FileChange> = None;
    let mut hunk: Option<Hunk> = None;
    let (mut old_number, mut new_number) = (0, 0);
    let finish_hunk = |file: &mut Option<FileChange>, hunk: &mut Option<Hunk>| {
        if let (Some(file), Some(hunk)) = (file.as_mut(), hunk.take()) { file.hunks.push(hunk); }
    };
    let finish_file = |files: &mut Vec<FileChange>, file: &mut Option<FileChange>| {
        if let Some(file) = file.take() { files.push(file); }
    };

    for line in patch.lines() {
        if let Some(rest) = line.strip_prefix("diff --git a/") {
            finish_hunk(&mut current, &mut hunk);
            finish_file(&mut files, &mut current);
            if let Some((old, new)) = rest.split_once(" b/") {
                current = Some(FileChange { path: new.into(), old_path: old.into(), status: "modified", additions: 0, deletions: 0, hunks: Vec::new() });
            }
            continue;
        }
        let Some(file) = current.as_mut() else { continue };
        if line.starts_with("new file mode ") { file.status = "added"; }
        if line.starts_with("deleted file mode ") { file.status = "deleted"; }
        if line.starts_with("rename from ") { file.status = "renamed"; }
        if let Some(path) = line.strip_prefix("rename to ") { file.path = path.into(); }
        if line.starts_with("Binary files ") || line == "GIT binary patch" { file.status = "binary"; }
        if line.starts_with("@@ ") {
            finish_hunk(&mut current, &mut hunk);
            old_number = parse_range(line, '-').unwrap_or(0);
            new_number = parse_range(line, '+').unwrap_or(0);
            hunk = Some(Hunk { header: line.into(), lines: Vec::new() });
            continue;
        }
        let Some(hunk) = hunk.as_mut() else { continue };
        let (kind, text, old, new) = if let Some(text) = line.strip_prefix('+') {
            file.additions += 1;
            let n = new_number; new_number += 1;
            ("add", text, None, Some(n))
        } else if let Some(text) = line.strip_prefix('-') {
            file.deletions += 1;
            let n = old_number; old_number += 1;
            ("delete", text, Some(n), None)
        } else if let Some(text) = line.strip_prefix(' ') {
            let o = old_number; let n = new_number;
            old_number += 1; new_number += 1;
            ("context", text, Some(o), Some(n))
        } else { continue };
        hunk.lines.push(Line { kind, text: text.into(), old_number: old, new_number: new });
    }
    finish_hunk(&mut current, &mut hunk);
    finish_file(&mut files, &mut current);

    let additions = files.iter().map(|file| file.additions).sum();
    let deletions = files.iter().map(|file| file.deletions).sum();
    Review { files, additions, deletions }
}

#[wasm_bindgen]
pub fn analyze_patch(patch: &str) -> Result<String, JsValue> {
    serde_json::to_string(&analyze(patch)).map_err(|error| JsValue::from_str(&error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_files_and_counts_hunk_lines() {
        let patch = "diff --git a/src/a.rs b/src/a.rs\n--- a/src/a.rs\n+++ b/src/a.rs\n@@ -4,2 +4,2 @@\n old\n-before\n+after\ndiff --git a/src/b.rs b/src/b.rs\nnew file mode 100644\n--- /dev/null\n+++ b/src/b.rs\n@@ -0,0 +1 @@\n+new\n";
        let review = analyze(patch);
        assert_eq!(review.files.len(), 2);
        assert_eq!(review.additions, 2);
        assert_eq!(review.deletions, 1);
        assert_eq!(review.files[0].hunks[0].lines[1].old_number, Some(5));
        assert_eq!(review.files[0].hunks[0].lines[2].new_number, Some(5));
        assert_eq!(review.files[1].status, "added");
    }
}
