import { useCallback, useMemo, useState } from "react";
import {
  Animated,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  PanResponder,
  type PanResponderGestureState,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import TrashIcon from "../icons/TrashIcon";
import type { Id, Task, TaskDragLayout } from "../types";

const DRAG_ACTIVATION_DELAY_MS = 180;
const DRAG_ACTIVATION_DISTANCE = 8;
const CARD_PADDING = 8;

class TaskGestureState {
  private ready = false;
  private dragging = false;
  private responderActive = false;
  private suppressPress = false;

  isReady() {
    return this.ready;
  }

  isDragging() {
    return this.dragging;
  }

  isResponderActive() {
    return this.responderActive;
  }

  setReady(ready: boolean) {
    this.ready = ready;
    if (ready) {
      this.suppressPress = true;
    }
  }

  setDragging(dragging: boolean) {
    this.dragging = dragging;
  }

  setResponderActive(responderActive: boolean) {
    this.responderActive = responderActive;
  }

  reset() {
    this.ready = false;
    this.dragging = false;
    this.responderActive = false;
  }

  beginTouch() {
    this.suppressPress = false;
  }

  shouldSuppressPress() {
    return this.ready || this.dragging || this.suppressPress;
  }

  clearPressSuppression() {
    this.suppressPress = false;
  }
}

interface TaskCardProps {
  task: Task;
  deleteTask: (id: Task["id"]) => void;
  updateTask: (id: Task["id"], content: Task["content"]) => void;
  moveTask: (id: Id, deltaX: number, deltaY: number) => void;
  isEditing: boolean;
  isOverlay?: boolean;
  isDragPreviewSource?: boolean;
  onTaskDragStart?: (task: Task, layout: TaskDragLayout) => void;
  onTaskDragMove?: (
    deltaX: number,
    deltaY: number,
    pointerX: number,
    pointerY: number,
  ) => void;
  onTaskDragEnd?: (dropAccepted: boolean) => void;
  onTaskTouchStart?: () => void;
  onTaskTouchEnd?: () => void;
  setEditingTaskId: (id: Id | null) => void;
}

function TaskCard({
  task,
  deleteTask,
  updateTask,
  moveTask,
  isEditing,
  isOverlay = false,
  isDragPreviewSource = false,
  onTaskDragStart,
  onTaskDragMove,
  onTaskDragEnd,
  onTaskTouchStart,
  onTaskTouchEnd,
  setEditingTaskId,
}: TaskCardProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [taskGestureState] = useState(() => new TaskGestureState());
  const [cardLayout, setCardLayout] = useState({ width: 250, height: 50 });

  const getTaskDragLayout = useCallback(
    (
      event: GestureResponderEvent,
      gesture?: PanResponderGestureState,
      localOffset = { x: 0, y: 0 },
    ) => {
      const width = cardLayout.width || 250;
      const height = cardLayout.height || 50;
      const { locationX, locationY } = event.nativeEvent;
      const pageX = Number.isFinite(event.nativeEvent.pageX)
        ? event.nativeEvent.pageX
        : (gesture?.x0 ?? width / 2);
      const pageY = Number.isFinite(event.nativeEvent.pageY)
        ? event.nativeEvent.pageY
        : (gesture?.y0 ?? height / 2);
      const touchOffsetX = Number.isFinite(locationX)
        ? locationX + localOffset.x
        : width / 2;
      const touchOffsetY = Number.isFinite(locationY)
        ? locationY + localOffset.y
        : height / 2;

      return {
        x: pageX - touchOffsetX,
        y: pageY - touchOffsetY,
        width,
        height,
        touchOffsetX,
        touchOffsetY,
      };
    },
    [cardLayout.height, cardLayout.width],
  );

  const startTaskDrag = useCallback(
    (
      event: GestureResponderEvent,
      gesture?: PanResponderGestureState,
      localOffset = { x: 0, y: 0 },
    ) => {
      if (isOverlay || isEditing || taskGestureState.isDragging()) {
        return;
      }

      taskGestureState.setReady(true);
      taskGestureState.setDragging(true);
      setIsDragging(true);
      onTaskTouchStart?.();
      onTaskDragStart?.(task, getTaskDragLayout(event, gesture, localOffset));
    },
    [
      getTaskDragLayout,
      isEditing,
      isOverlay,
      onTaskDragStart,
      onTaskTouchStart,
      task,
      taskGestureState,
    ],
  );

  const finishTaskDrag = useCallback(
    (deltaX = 0, deltaY = 0, shouldMoveTask = false) => {
      const wasDragging = taskGestureState.isDragging();

      taskGestureState.reset();
      setIsDragging(false);

      if (wasDragging) {
        if (shouldMoveTask) {
          moveTask(task.id, deltaX, deltaY);
        }

        onTaskDragEnd?.(shouldMoveTask);
      }

      onTaskTouchEnd?.();
    },
    [moveTask, onTaskDragEnd, onTaskTouchEnd, task.id, taskGestureState],
  );

  const taskPanResponder = useMemo(() => {
    function shouldStartTaskDrag(
      _event: GestureResponderEvent,
      gesture: PanResponderGestureState,
    ) {
      if (isOverlay || isEditing) {
        return false;
      }

      if (taskGestureState.isDragging()) {
        return true;
      }

      if (!taskGestureState.isReady()) {
        return false;
      }

      const distance = Math.abs(gesture.dx) + Math.abs(gesture.dy);
      return distance >= DRAG_ACTIVATION_DISTANCE;
    }

    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: shouldStartTaskDrag,

      onMoveShouldSetPanResponder: shouldStartTaskDrag,

      onPanResponderGrant: (event, gesture) => {
        taskGestureState.setResponderActive(true);
        startTaskDrag(event, gesture);
      },

      onPanResponderMove: (event, gesture) => {
        const pointerX = Number.isFinite(gesture.moveX)
          ? gesture.moveX
          : event.nativeEvent.pageX;
        const pointerY = Number.isFinite(gesture.moveY)
          ? gesture.moveY
          : event.nativeEvent.pageY;

        onTaskDragMove?.(gesture.dx, gesture.dy, pointerX, pointerY);
      },

      onPanResponderRelease: (_, gesture) => {
        finishTaskDrag(gesture.dx, gesture.dy, true);
      },

      onPanResponderTerminate: () => {
        finishTaskDrag();
      },

      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
    });
  }, [
    finishTaskDrag,
    isEditing,
    isOverlay,
    onTaskDragMove,
    startTaskDrag,
    taskGestureState,
  ]);

  function handleTouchFinish() {
    if (taskGestureState.isDragging()) {
      if (!taskGestureState.isResponderActive()) {
        finishTaskDrag();
      }

      return;
    }

    taskGestureState.reset();
    onTaskTouchEnd?.();
  }

  function handleCardLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;

    setCardLayout((currentLayout) => {
      if (currentLayout.width === width && currentLayout.height === height) {
        return currentLayout;
      }

      return {
        width,
        height,
      };
    });
  }

  if (isOverlay) {
    return (
      <View style={[styles.card, styles.overlayCard]}>
        <View style={styles.contentButton}>
          <Text style={styles.content}>{task.content}</Text>
        </View>

        <View style={styles.deleteButton}>
          <TrashIcon />
        </View>
      </View>
    );
  }

  if (isEditing) {
    return (
      <Pressable
        style={styles.card}
        onPress={(event) => event.stopPropagation()}
      >
        <TextInput
          value={task.content}
          autoFocus
          multiline
          placeholder="Task content here"
          placeholderTextColor="#8b949e"
          onChangeText={(content) => updateTask(task.id, content)}
          onBlur={() => {
            if (!isDragging) {
              setEditingTaskId(null);
            }
          }}
          style={styles.input}
          selectionColor="#f43f5e"
        />
      </Pressable>
    );
  }

  return (
    <Animated.View
      onLayout={handleCardLayout}
      onTouchCancel={handleTouchFinish}
      onTouchEnd={handleTouchFinish}
      onTouchStart={() => taskGestureState.beginTouch()}
      pointerEvents={isDragPreviewSource && !isDragging ? "none" : "auto"}
      style={[
        styles.card,
        isDragging && styles.draggingCard,
        isDragPreviewSource && styles.dragPreviewSourceCard,
      ]}
      {...taskPanResponder.panHandlers}
    >
      <TouchableOpacity
        activeOpacity={0.9}
        accessibilityLabel={`Edit task ${task.content}`}
        accessibilityRole="button"
        delayLongPress={DRAG_ACTIVATION_DELAY_MS}
        onLongPress={(event) => {
          startTaskDrag(event, undefined, {
            x: CARD_PADDING,
            y: CARD_PADDING,
          });
        }}
        onPress={(event) => {
          if (taskGestureState.shouldSuppressPress()) {
            event.stopPropagation();
            taskGestureState.clearPressSuppression();
            return;
          }

          event.stopPropagation();
          setEditingTaskId(task.id);
        }}
        style={styles.contentButton}
      >
        <Text style={styles.content}>{task.content}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        activeOpacity={0.7}
        accessibilityLabel={`Delete task ${task.content}`}
        accessibilityRole="button"
        onPress={(event) => {
          event.stopPropagation();
          deleteTask(task.id);
        }}
        style={styles.deleteButton}
      >
        <TrashIcon />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    maxHeight: 200,
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    padding: CARD_PADDING,
    borderWidth: 2,
    borderColor: "transparent",
    borderRadius: 12,
    backgroundColor: "#0d1117",
  },
  draggingCard: {
    opacity: 0.25,
    borderColor: "#f43f5e",
  },
  dragPreviewSourceCard: {
    position: "absolute",
    left: 8,
    right: 8,
    opacity: 0,
  },
  overlayCard: {
    borderColor: "#30363d",
    backgroundColor: "#111820",
    shadowColor: "#000000",
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 18,
  },
  contentButton: {
    flex: 1,
    minHeight: 30,
    justifyContent: "center",
  },
  content: {
    color: "#ffffff",
    fontSize: 15,
  },
  input: {
    flex: 1,
    minHeight: 80,
    color: "#ffffff",
    textAlignVertical: "top",
  },
  deleteButton: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
    backgroundColor: "#161c22",
  },
});

export default TaskCard;
