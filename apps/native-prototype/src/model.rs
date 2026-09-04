use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Image,
    Video,
    Live,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Item {
    pub id: String,
    pub title: String,
    pub kind: Kind,
    pub path: PathBuf,
    pub preview: Option<PathBuf>,
    pub description: String,
    pub tags: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Group {
    pub id: String,
    pub item: String,
    pub outputs: Vec<String>,
    pub span: bool,
    pub fps: u32,
    pub audio: bool,
    #[serde(default)]
    pub paused: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Library {
    pub items: Vec<Item>,
    pub groups: Vec<Group>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Monitor {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub scale: f64,
    #[serde(default)]
    pub transform: i32,
    #[serde(default = "yes", rename = "dpmsStatus")]
    pub powered: bool,
    #[serde(default)]
    pub disabled: bool,
}
fn yes() -> bool {
    true
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl Monitor {
    pub fn rect(&self) -> Rect {
        let (w, h) = if self.transform % 2 != 0 {
            (self.height, self.width)
        } else {
            (self.width, self.height)
        };
        Rect {
            x: self.x,
            y: self.y,
            width: (w as f64 / self.scale).round() as i32,
            height: (h as f64 / self.scale).round() as i32,
        }
    }
}

/// Logical compositor coordinates, including rotation, scale, gaps and negative origins.
pub fn viewport(group: &Group, monitor: &Monitor, monitors: &[Monitor]) -> (Rect, Rect) {
    let local = monitor.rect();
    if !group.span {
        return (
            Rect {
                x: 0,
                y: 0,
                ..local
            },
            Rect {
                x: 0,
                y: 0,
                ..local
            },
        );
    }
    let members: Vec<_> = monitors
        .iter()
        .filter(|m| group.outputs.contains(&m.name) && !m.disabled)
        .map(Monitor::rect)
        .collect();
    let x = members.iter().map(|r| r.x).min().unwrap_or(local.x);
    let y = members.iter().map(|r| r.y).min().unwrap_or(local.y);
    let right = members
        .iter()
        .map(|r| r.x + r.width)
        .max()
        .unwrap_or(local.x + local.width);
    let bottom = members
        .iter()
        .map(|r| r.y + r.height)
        .max()
        .unwrap_or(local.y + local.height);
    (
        Rect {
            x,
            y,
            width: right - x,
            height: bottom - y,
        },
        Rect {
            x: local.x - x,
            y: local.y - y,
            ..local
        },
    )
}

pub fn contained_file(root: &Path, relative: &Path) -> Result<PathBuf> {
    let root = root.canonicalize()?;
    let path = root
        .join(relative)
        .canonicalize()
        .with_context(|| format!("Missing file: {}", relative.display()))?;
    if !path.starts_with(&root) || !path.is_file() {
        bail!("Bundle files must remain inside {}", root.display());
    }
    Ok(path)
}

pub fn inspect(path: &Path) -> Result<Item> {
    let path = path
        .canonicalize()
        .with_context(|| format!("Cannot open {}", path.display()))?;
    if path.is_dir() {
        #[derive(Deserialize)]
        struct Manifest {
            title: String,
            entry: PathBuf,
            preview: Option<PathBuf>,
            #[serde(default)]
            description: String,
            #[serde(default)]
            tags: Vec<String>,
        }
        let manifest: Manifest = serde_json::from_slice(&fs::read(path.join("wallpaper.json"))?)
            .context("Invalid wallpaper.json")?;
        let entry = contained_file(&path, &manifest.entry)?;
        if entry.extension().and_then(|v| v.to_str()) != Some("html") {
            bail!("Live bundle entry must be an HTML file");
        }
        let preview = manifest
            .preview
            .map(|p| contained_file(&path, &p))
            .transpose()?;
        return Ok(Item {
            id: stable_id(&path),
            title: manifest.title,
            kind: Kind::Live,
            path: entry,
            preview,
            description: manifest.description,
            tags: manifest.tags,
        });
    }
    if !path.is_file() {
        bail!("Choose a regular image, video, HTML file, or live wallpaper directory");
    }
    let extension = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    let kind = match extension.as_str() {
        "png" | "jpg" | "jpeg" | "webp" | "bmp" | "svg" => Kind::Image,
        "mp4" | "webm" | "mkv" | "mov" | "m4v" | "ogv" => Kind::Video,
        "html" | "htm" => Kind::Live,
        _ => bail!("Unsupported file type: .{extension}"),
    };
    let title = path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .replace(['-', '_'], " ");
    let preview = if kind == Kind::Image {
        Some(path.clone())
    } else {
        ["jpg", "png", "svg"]
            .iter()
            .map(|ext| path.with_extension(ext))
            .find(|p| p.is_file())
    };
    Ok(Item {
        id: stable_id(&path),
        title,
        preview,
        path,
        kind,
        description: "From your local collection".into(),
        tags: vec![],
    })
}

fn stable_id(path: &Path) -> String {
    use std::hash::{Hash, Hasher};
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut hash);
    format!("{:016x}", hash.finish())
}

impl Library {
    pub fn import(&mut self, path: &Path) -> Result<String> {
        let item = inspect(path)?;
        let id = item.id.clone();
        self.items.retain(|i| i.id != id);
        self.items.push(item);
        Ok(id)
    }

    pub fn assign(&mut self, group: Group, monitors: &[Monitor]) -> Result<()> {
        if group.outputs.is_empty() {
            bail!("Select at least one monitor");
        }
        if !(1..=60).contains(&group.fps) {
            bail!("Frame rate must be between 1 and 60");
        }
        let names: HashSet<_> = group.outputs.iter().collect();
        if names.len() != group.outputs.len() {
            bail!("Monitor names must be unique");
        }
        for name in &group.outputs {
            if !monitors.iter().any(|m| &m.name == name && !m.disabled) {
                bail!("Monitor {name} is not connected");
            }
        }
        let item = self
            .items
            .iter()
            .find(|i| i.id == group.item)
            .context("Wallpaper is not in the library")?;
        if !item.path.is_file() {
            bail!("Wallpaper file is missing: {}", item.path.display());
        }
        self.clear(&group.outputs);
        self.groups.push(group);
        Ok(())
    }

    pub fn clear(&mut self, outputs: &[String]) {
        for existing in &mut self.groups {
            existing.outputs.retain(|o| !outputs.contains(o));
        }
        self.groups.retain(|g| !g.outputs.is_empty());
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        let parent = path
            .parent()
            .context("State file must have a parent directory")?;
        fs::create_dir_all(parent)?;
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_vec_pretty(self)?)?;
        fs::rename(tmp, path)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn monitor(name: &str, x: i32, y: i32) -> Monitor {
        Monitor {
            name: name.into(),
            x,
            y,
            width: 1920,
            height: 1080,
            scale: 1.,
            powered: true,
            ..Default::default()
        }
    }
    fn group(outputs: &[&str]) -> Group {
        Group {
            id: "g".into(),
            item: "i".into(),
            outputs: outputs.iter().map(|s| s.to_string()).collect(),
            span: true,
            fps: 30,
            audio: false,
            paused: false,
        }
    }

    #[test]
    fn span_preserves_negative_origins_gaps_rotation_and_fractional_scale() {
        let mut left = monitor("portrait", -1080, 0);
        left.transform = 1;
        let upper = monitor("DP-2", 320, -1080);
        let mut main = monitor("main", 0, 0);
        main.width = 3840;
        main.height = 2160;
        main.scale = 1.5;
        let monitors = vec![left, upper.clone(), main];
        let (canvas, crop) = viewport(&group(&["portrait", "DP-2", "main"]), &upper, &monitors);
        assert_eq!(
            canvas,
            Rect {
                x: -1080,
                y: -1080,
                width: 3640,
                height: 3000
            }
        );
        assert_eq!(
            crop,
            Rect {
                x: 1400,
                y: 0,
                width: 1920,
                height: 1080
            }
        );
    }

    #[test]
    fn replacing_one_member_preserves_other_members_and_independent_groups() {
        let mut library = Library {
            groups: vec![group(&["A", "B"]), group(&["C"])],
            ..Default::default()
        };
        library.clear(&["B".into()]);
        assert_eq!(library.groups[0].outputs, ["A"]);
        assert_eq!(library.groups[1].outputs, ["C"]);
    }

    #[test]
    fn disconnected_members_do_not_leave_an_invisible_span_gap() {
        let mon = monitor("A", 100, -400);
        let (canvas, crop) = viewport(
            &group(&["A", "disconnected"]),
            &mon,
            std::slice::from_ref(&mon),
        );
        assert_eq!(canvas.width, 1920);
        assert_eq!(crop.x, 0);
        assert_eq!(crop.y, 0);
    }

    #[test]
    fn validation_never_mutates_existing_layout() {
        let mut library = Library {
            groups: vec![group(&["A"])],
            ..Default::default()
        };
        let before = serde_json::to_string(&library).unwrap();
        assert!(library
            .assign(group(&["missing"]), &[monitor("A", 0, 0)])
            .is_err());
        assert!(library
            .assign(group(&["A", "A"]), &[monitor("A", 0, 0)])
            .is_err());
        assert_eq!(before, serde_json::to_string(&library).unwrap());
    }

    #[test]
    fn bundles_reject_parent_paths_and_symlinks_outside_root() {
        let dir = std::env::temp_dir().join(format!("wallpaperdb-test-{}", std::process::id()));
        fs::create_dir_all(dir.join("bundle")).unwrap();
        fs::write(dir.join("secret"), "private").unwrap();
        assert!(contained_file(&dir.join("bundle"), Path::new("../secret")).is_err());
        std::os::unix::fs::symlink(dir.join("secret"), dir.join("bundle/link")).unwrap();
        assert!(contained_file(&dir.join("bundle"), Path::new("link")).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
