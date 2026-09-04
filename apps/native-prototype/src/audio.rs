use serde::Serialize;
use std::{
    io::Read,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};

#[derive(Clone, Debug, Serialize)]
pub struct Levels {
    pub available: bool,
    pub rms: f32,
    pub bands: Vec<f32>,
    pub error: Option<String>,
}
impl Default for Levels {
    fn default() -> Self {
        Self {
            available: false,
            rms: 0.,
            bands: vec![0.; 16],
            error: None,
        }
    }
}

pub struct Audio {
    child: Option<Child>,
    pub levels: Arc<Mutex<Levels>>,
}
impl Audio {
    pub fn new() -> Self {
        Self {
            child: None,
            levels: Arc::new(Mutex::new(Levels::default())),
        }
    }
    pub fn set_active(&mut self, active: bool) {
        if !active {
            if let Some(mut child) = self.child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
            *self.levels.lock().unwrap() = Levels::default();
            return;
        }
        if self.child.is_some() {
            return;
        }
        // PipeWire's Pulse server exposes the output monitor. Never captures a microphone.
        match Command::new("parec")
            .args([
                "--device=@DEFAULT_MONITOR@",
                "--format=float32le",
                "--rate=24000",
                "--channels=1",
                "--latency-msec=50",
                "--raw",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(mut child) => {
                let mut output = child.stdout.take().unwrap();
                let levels = self.levels.clone();
                thread::spawn(move || {
                    let mut bytes = [0_u8; 4096];
                    while output.read_exact(&mut bytes).is_ok() {
                        let samples: Vec<_> = bytes
                            .chunks_exact(4)
                            .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
                            .map(|v| if v.is_finite() { v } else { 0. })
                            .collect();
                        *levels.lock().unwrap() = analyze(&samples);
                    }
                    let mut last = levels.lock().unwrap();
                    last.available = false;
                    last.rms = 0.;
                    last.bands.fill(0.);
                    last.error = Some(
                        "System audio monitor unavailable; check PipeWire / pipewire-pulse".into(),
                    );
                });
                self.child = Some(child);
            }
            Err(err) => {
                self.levels.lock().unwrap().error = Some(format!("Install libpulse (parec): {err}"))
            }
        }
    }
}
impl Drop for Audio {
    fn drop(&mut self) {
        self.set_active(false);
    }
}

fn analyze(samples: &[f32]) -> Levels {
    let count = samples.len() as f32;
    let rms = (samples.iter().map(|v| v * v).sum::<f32>() / count)
        .sqrt()
        .clamp(0., 1.);
    // Sixteen log-spaced Goertzel bins. Bounded work: one small block, ~24 times/sec.
    let bands = (0..16)
        .map(|i| {
            let frequency = 55_f32 * (8000_f32 / 55.).powf(i as f32 / 15.);
            let coeff = 2. * (std::f32::consts::TAU * frequency / 24000.).cos();
            let (mut a, mut b) = (0., 0.);
            for (n, sample) in samples.iter().enumerate() {
                let hann = 0.5 - 0.5 * (std::f32::consts::TAU * n as f32 / count).cos();
                let next = sample * hann + coeff * a - b;
                b = a;
                a = next;
            }
            ((a * a + b * b - coeff * a * b).max(0.).sqrt() * 8. / count).clamp(0., 1.)
        })
        .collect();
    Levels {
        available: true,
        rms,
        bands,
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn audio_analysis_distinguishes_silence_and_a_tone() {
        let silence = analyze(&[0.; 1024]);
        assert_eq!(silence.rms, 0.);
        let samples: Vec<_> = (0..1024)
            .map(|i| (std::f32::consts::TAU * 440. * i as f32 / 24000.).sin() * 0.5)
            .collect();
        let tone = analyze(&samples);
        assert!((tone.rms - 0.354).abs() < 0.01);
        assert!(tone.bands.iter().any(|v| *v > 0.1));
        assert!(tone.bands[15] < 0.01);
    }
}
