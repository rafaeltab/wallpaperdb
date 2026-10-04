// Throwaway #326 visual explanation. These are simulated shapes of one photo,
// not verified source measurements or a crop promise from the browse filter.
export function BrowseShapeComparison() {
  const target = 16 / 9;
  return (
    <section className="space-y-3">
      <h2 className="font-semibold">What does the tolerance look like?</h2>
      <p className="text-sm text-muted-foreground">
        Each source is slightly narrower than 16:9. Compare keeping the whole image with filling the
        screen. The same placeholder photo is reshaped to illustrate the difference. Browsing itself
        does not crop, stretch or promise a rendition.
      </p>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[1, 2, 3, 5].map((percent) => {
          const factor = 1 + percent / 100;
          const loss = (1 - 1 / factor) * 100;
          return (
            <div key={percent} className="space-y-2 rounded-lg border p-3 text-xs">
              <h3 className="font-medium">{percent}% shape distance</h3>
              <p>
                Source ratio {(target / factor).toFixed(4)}. At most {loss.toFixed(2)}% of one axis
                is cropped.
              </p>
              <p>Fit the whole image</p>
              <div
                className="relative overflow-hidden bg-zinc-950"
                style={{ aspectRatio: '16 / 9' }}
              >
                <img
                  alt={`${percent}% narrower source fitted inside 16:9`}
                  src="/rendition-prototype/mountain.jpg"
                  className="absolute top-0 h-full"
                  style={{ width: `${100 / factor}%`, left: `${loss / 2}%` }}
                />
              </div>
              <p>Fill the screen, center crop</p>
              <div
                className="relative overflow-hidden bg-zinc-950"
                style={{ aspectRatio: '16 / 9' }}
              >
                <img
                  alt={`${percent}% narrower source center cropped to 16:9`}
                  src="/rendition-prototype/mountain.jpg"
                  className="absolute left-0 w-full"
                  style={{ height: `${100 * factor}%`, top: `${-percent / 2}%` }}
                />
              </div>
              <p>
                On a 1920 × 1080 display: about {Math.round((1920 * loss) / 100)} px total empty
                width, or {Math.round((1080 * loss) / 100)} px total source height cropped at this
                scale. Wider sources swap the affected axis.
              </p>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        A 3% tolerance compares shapes, not 3% of all image pixels or a guarantee that important
        edge content survives. Minimum width and height still apply independently.
      </p>
    </section>
  );
}
