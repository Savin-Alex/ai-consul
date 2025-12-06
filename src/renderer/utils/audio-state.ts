export enum AudioState {
  IDLE = 'idle',
  REQUESTING_PERMISSION = 'requesting_permission',
  INITIALIZING_CONTEXT = 'initializing_context',
  LOADING_WORKLET = 'loading_worklet',
  READY = 'ready',
  RECORDING = 'recording',
  PAUSED = 'paused',
  STOPPING = 'stopping',
  CLEANING_UP = 'cleaning_up',
  ERROR = 'error'
}



