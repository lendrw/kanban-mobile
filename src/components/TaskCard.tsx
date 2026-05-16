import { useMemo, useState } from "react";
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
import type { Id, Task } from "../types";

const DRAG_ACTIVATION_DELAY_MS = 180;
const DRAG_ACTIVATION_DISTANCE = 8;

class TaskGestureState {
  private ready = false;
  private dragging = false;
  private suppressPress = false;

  isReady() {
    return this.ready;
  }

  isDragging() {
    return this.dragging;
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

  reset() {
    this.ready = false;
    this.dragging = false;
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

type TaskDragLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
};

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
  onTaskDragEnd?: () => void;
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

  const taskPanResponder = useMemo(() => {
    function shouldStartTaskDrag(
      _event: GestureResponderEvent,
      gesture: PanResponderGestureState,
    ) {
      if (isOverlay || isEditing || !taskGestureState.isReady()) {
        return false;
      }

      const distance = Math.abs(gesture.dx) + Math.abs(gesture.dy);
      return distance >= DRAG_ACTIVATION_DISTANCE;
    }

    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: shouldStartTaskDrag,

      onMoveShouldSetPanResponder: shouldStartTaskDrag,

      onPanResponderGrant: (event, gesture) => {
        const width = cardLayout.width || 250;
        const height = cardLayout.height || 50;
        const { locationX, locationY } = event.nativeEvent;
        const pageX = Number.isFinite(event.nativeEvent.pageX)
          ? event.nativeEvent.pageX
          : gesture.x0;
        const pageY = Number.isFinite(event.nativeEvent.pageY)
          ? event.nativeEvent.pageY
          : gesture.y0;
        const touchOffsetX = Number.isFinite(locationX)
          ? locationX
          : width / 2;
        const touchOffsetY = Number.isFinite(locationY)
          ? locationY
          : height / 2;

        taskGestureState.setDragging(true);
        setIsDragging(true);
        onTaskDragStart?.(task, {
          x: pageX - touchOffsetX,
          y: pageY - touchOffsetY,
          width,
          height,
        });
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
        taskGestureState.reset();
        setIsDragging(false);

        onTaskDragEnd?.();
        onTaskTouchEnd?.();
        moveTask(task.id, gesture.dx, gesture.dy);
      },

      onPanResponderTerminate: () => {
        taskGestureState.reset();
        setIsDragging(false);
        onTaskDragEnd?.();
        onTaskTouchEnd?.();
      },

      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
    });
  }, [
    cardLayout.height,
    cardLayout.width,
    isEditing,
    isOverlay,
    moveTask,
    onTaskDragEnd,
    onTaskDragMove,
    onTaskDragStart,
    onTaskTouchEnd,
    task,
    taskGestureState,
  ]);

  function resetReadyGesture() {
    if (!taskGestureState.isDragging()) {
      taskGestureState.reset();
      onTaskTouchEnd?.();
    }
  }

  function handleCardLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;

    setCardLayout((currentLayout) => {
      if (
        currentLayout.width === width &&
        currentLayout.height === height
      ) {
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
      onTouchCancel={resetReadyGesture}
      onTouchEnd={resetReadyGesture}
      onTouchStart={() => taskGestureState.beginTouch()}
      pointerEvents={
        isDragPreviewSource && !isDragging ? "none" : "auto"
      }
      style={[
        styles.card,
        isDragging && styles.draggingCard,
        isDragPreviewSource && styles.dragPreviewSourceCard,
      ]}
      {...taskPanResponder.panHandlers}
    >
      <TouchableOpacity
        activeOpacity={0.9}
        delayLongPress={DRAG_ACTIVATION_DELAY_MS}
        onLongPress={() => {
          taskGestureState.setReady(true);
          onTaskTouchStart?.();
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
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
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
    width: 35,
    height: 35,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
    backgroundColor: "#161c22",
  },
});

export default TaskCard;
