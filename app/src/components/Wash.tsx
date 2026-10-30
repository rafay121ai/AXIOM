import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

// An ellipse as the mock says it (radii as a share of the screen's width and height): a circle of the height radius,
// stretched across by the ratio of the two. Some renderers ignore separate radii, so the stretch is written out.
const ellipse = (cx: number, cy: number, rx: number, ry: number) => ({
  cx, cy, r: ry, gradientTransform: `translate(${cx} ${cy}) scale(${rx / ry} 1) translate(${-cx} ${-cy})`,
});

// The very faint, smooth gold behind the black on the home, drawer, History and Settings: strongest at the bottom
// (about 26%), a whisper at the top (about 10%), no blobs. The numbers are the mock's (.hmwash and the drawer's corner).
export function Wash({ corner = false }: { corner?: boolean }) {
  return (
    <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        {corner ? (
          <RadialGradient id="washCorner" {...ellipse(0, 1.04, 1.2, 0.45)}>
            <Stop offset="0" stopColor="rgb(205,178,126)" stopOpacity={0.1} />
            <Stop offset="0.62" stopColor="rgb(205,178,126)" stopOpacity={0} />
          </RadialGradient>
        ) : (
          <>
            <RadialGradient id="washBottom" {...ellipse(0.5, 1.08, 1.3, 0.58)}>
              <Stop offset="0" stopColor="rgb(205,178,126)" stopOpacity={0.26} />
              <Stop offset="0.66" stopColor="rgb(205,178,126)" stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id="washTop" {...ellipse(0.5, -0.08, 1, 0.4)}>
              <Stop offset="0" stopColor="rgb(205,178,126)" stopOpacity={0.1} />
              <Stop offset="0.72" stopColor="rgb(205,178,126)" stopOpacity={0} />
            </RadialGradient>
            <LinearGradient id="washSheen" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="rgb(168,142,94)" stopOpacity={0.05} />
              <Stop offset="0.5" stopColor="rgb(168,142,94)" stopOpacity={0} />
            </LinearGradient>
          </>
        )}
      </Defs>
      {corner ? (
        <Rect width="100%" height="100%" fill="url(#washCorner)" />
      ) : (
        <>
          <Rect width="100%" height="100%" fill="url(#washSheen)" />
          <Rect width="100%" height="100%" fill="url(#washTop)" />
          <Rect width="100%" height="100%" fill="url(#washBottom)" />
        </>
      )}
    </Svg>
  );
}
