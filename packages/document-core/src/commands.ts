import { validateAnnotation, type Annotation } from "./annotations";

export type EditCommand =
  | Readonly<{ type: "add"; annotation: Annotation }>
  | Readonly<{ type: "replace"; annotation: Annotation }>
  | Readonly<{ type: "remove"; annotationId: string }>;

export interface EditorState {
  readonly annotations: readonly Annotation[];
  readonly undoStack: readonly (readonly Annotation[])[];
  readonly redoStack: readonly (readonly Annotation[])[];
  readonly revision: number;
}

const HISTORY_LIMIT = 100;

export function initialEditorState(annotations: readonly Annotation[] = []): EditorState {
  if (annotations.length > 50_000) throw new RangeError("Too many annotations.");
  annotations.forEach(validateAnnotation);
  if (new Set(annotations.map((annotation) => annotation.id)).size !== annotations.length) {
    throw new RangeError("Duplicate annotation IDs.");
  }
  return { annotations: [...annotations], undoStack: [], redoStack: [], revision: 0 };
}

export function applyCommand(state: EditorState, command: EditCommand): EditorState {
  let next: readonly Annotation[];
  switch (command.type) {
    case "add":
      validateAnnotation(command.annotation);
      if (state.annotations.some((annotation) => annotation.id === command.annotation.id)) {
        throw new RangeError("Duplicate annotation ID.");
      }
      next = [...state.annotations, command.annotation];
      break;
    case "replace":
      validateAnnotation(command.annotation);
      if (!state.annotations.some((annotation) => annotation.id === command.annotation.id)) {
        throw new RangeError("Annotation to replace does not exist.");
      }
      next = state.annotations.map((annotation) =>
        annotation.id === command.annotation.id ? command.annotation : annotation
      );
      break;
    case "remove":
      if (!state.annotations.some((annotation) => annotation.id === command.annotationId)) {
        return state;
      }
      next = state.annotations.filter((annotation) => annotation.id !== command.annotationId);
      break;
  }
  return {
    annotations: next,
    undoStack: [...state.undoStack.slice(-(HISTORY_LIMIT - 1)), state.annotations],
    redoStack: [],
    revision: state.revision + 1
  };
}

export function undo(state: EditorState): EditorState {
  const previous = state.undoStack[state.undoStack.length - 1];
  if (!previous) return state;
  return {
    annotations: previous,
    undoStack: state.undoStack.slice(0, -1),
    redoStack: [...state.redoStack, state.annotations],
    revision: state.revision + 1
  };
}

export function redo(state: EditorState): EditorState {
  const next = state.redoStack[state.redoStack.length - 1];
  if (!next) return state;
  return {
    annotations: next,
    undoStack: [...state.undoStack.slice(-(HISTORY_LIMIT - 1)), state.annotations],
    redoStack: state.redoStack.slice(0, -1),
    revision: state.revision + 1
  };
}

export function hasEdits(state: EditorState): boolean {
  // Imported annotations are part of the persisted PDF, not unsaved edits.
  // Only explicit user mutations make a document dirty.
  return state.revision > 0;
}

/** Returns the persisted content, without transient undo history. */
export function snapshotAnnotations(state: EditorState): Annotation[] {
  return state.annotations.map((annotation) => structuredClone(annotation));
}
