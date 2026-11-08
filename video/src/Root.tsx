import { Composition } from 'remotion'
import './theme'
import { Demo, TOTAL_FRAMES } from './Demo'
import { FPS } from './timeline'

export const Root = () => (
  <Composition id="AxiomDemo" component={Demo} durationInFrames={TOTAL_FRAMES} fps={FPS} width={1920} height={1080} />
)
