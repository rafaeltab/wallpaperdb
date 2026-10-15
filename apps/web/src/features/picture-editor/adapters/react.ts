import { useCallback, useEffect, useRef, useState } from 'react';
import {
  initialPictureCrop,
  type PictureCrop,
  type PictureDecodedLimits,
  type PictureEncodingPolicy,
  type PictureSource,
} from '../index';
import { openPictureSource } from './browser';

interface Selection {
  owner: string;
  file: File;
  expectedVersion: number | null;
  source: PictureSource | null;
  crop: PictureCrop | null;
  previewUrl: string | null;
}

/** Owns local source work. The caller owns command acceptance and saved Profile state. */
export function usePictureEditor(owner: string, limits: PictureDecodedLimits) {
  const current = useRef<Selection | null>(null);
  const operation = useRef<AbortController | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function publish(next: Selection | null) {
    current.current = next;
    setSelection(next);
  }
  function cancel() {
    operation.current?.abort();
    operation.current = null;
    setProcessing(false);
  }
  const dispose = useCallback(() => {
    operation.current?.abort();
    operation.current = null;
    current.current?.source?.dispose();
    if (current.current?.previewUrl) URL.revokeObjectURL(current.current.previewUrl);
    current.current = null;
  }, []);
  function clear() {
    dispose();
    setSelection(null);
    setProcessing(false);
    setError(null);
  }
  useEffect(() => {
    // The cleanup also fences late results when the same owner is mounted in another session.
    if (current.current?.owner !== owner) dispose();
    setSelection(null);
    setProcessing(false);
    setError(null);
    return dispose;
  }, [owner, dispose]);
  async function decode(selected: Selection, controller: AbortController) {
    const source = await openPictureSource(selected.file, controller.signal, limits);
    if (controller.signal.aborted || current.current !== selected) {
      source.dispose();
      return null;
    }
    const decoded = {
      ...selected,
      source,
      crop: initialPictureCrop(source),
      previewUrl: URL.createObjectURL(source.preview),
    };
    publish(decoded);
    return decoded;
  }
  async function choose(file: File, expectedVersion: number | null) {
    clear();
    const selected: Selection = {
      owner,
      file,
      expectedVersion,
      source: null,
      crop: null,
      previewUrl: null,
    };
    publish(selected);
    const controller = new AbortController();
    operation.current = controller;
    setProcessing(true);
    try {
      await decode(selected, controller);
    } catch (cause) {
      if (!controller.signal.aborted && current.current === selected)
        setError(
          cause instanceof Error ? cause.message : 'Unable to decode this picture. Try again.'
        );
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setProcessing(false);
      }
    }
  }
  async function apply(
    policy: PictureEncodingPolicy,
    accept: (file: File, expectedVersion: number) => void
  ) {
    if (!current.current || current.current.expectedVersion === null || operation.current) return;
    let selected = current.current;
    const controller = new AbortController();
    operation.current = controller;
    setProcessing(true);
    setError(null);
    try {
      if (!selected.source) {
        const decoded = await decode(selected, controller);
        if (!decoded) return;
        selected = decoded;
      }
      if (!selected.source || !selected.crop || selected.expectedVersion === null) return;
      const blob = await selected.source.process(selected.crop, policy, controller.signal);
      if (controller.signal.aborted || current.current !== selected) return;
      accept(
        new File([blob], 'profile-picture.webp', { type: 'image/webp' }),
        selected.expectedVersion
      );
    } catch (cause) {
      if (!controller.signal.aborted && current.current === selected)
        setError(
          cause instanceof Error ? cause.message : 'Unable to process this picture. Try again.'
        );
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setProcessing(false);
      }
    }
  }
  return {
    selection,
    processing,
    error,
    choose,
    apply,
    clear,
    cancel,
    setExpectedVersion(expectedVersion: number | null) {
      if (current.current) publish({ ...current.current, expectedVersion });
    },
    setCrop(crop: PictureCrop) {
      if (current.current) publish({ ...current.current, crop });
    },
  };
}
