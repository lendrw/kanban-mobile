import { useCallback, useMemo, useRef, useState } from "react";
import {
  Animated,
  LayoutAnimation,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  UIManager,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Column, Id, Task } from "../types";
import ColumnContainer from "./ColumnContainer";
import TaskCard from "./TaskCard";

const COLUMN_WIDTH = 250;
const COLUMN_GAP = 16;
const TASK_HEIGHT = 100;
const TASK_GAP = 16;
const AUTO_SCROLL_EDGE_SIZE = 56;
const AUTO_SCROLL_STEP = 20;

type TaskDragState = {
  task: Task;
  width: number;
  height: number;
};

type TaskDragPreview = {
  taskId: Id;
  targetColumnId: Id;
  targetIndex: number;
  placeholderHeight: number;
};

type ColumnLayout = {
  x: number;
  width: number;
};

if (Platform.OS === "android") {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

class BoardDragMetrics {
  private boardScrollX = 0;
  private boardViewportX = 0;
  private boardViewportWidth = 0;
  private columnsContainerX = 0;
  private columnLayouts = new Map<string, ColumnLayout>();

  setBoardScrollX(scrollX: number) {
    this.boardScrollX = scrollX;
  }

  setBoardViewportLayout(x: number, width: number) {
    this.boardViewportX = x;
    this.boardViewportWidth = width;
  }

  getBoardScrollX() {
    return this.boardScrollX;
  }

  setColumnsContainerX(x: number) {
    this.columnsContainerX = x;
  }

  setColumnLayout(id: Id, layout: ColumnLayout) {
    this.columnLayouts.set(String(id), layout);
  }

  getTargetColumnId(columns: Column[], pointerX: number) {
    if (columns.length === 0) return null;

    const columnsLocalX =
      pointerX +
      this.boardScrollX -
      this.boardViewportX -
      this.columnsContainerX;

    let nearestColumnId: Id | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const column of columns) {
      const layout = this.columnLayouts.get(String(column.id));
      if (!layout) continue;

      const columnStart = layout.x;
      const columnEnd = layout.x + layout.width;

      if (columnsLocalX >= columnStart && columnsLocalX <= columnEnd) {
        return column.id;
      }

      const columnCenter = layout.x + layout.width / 2;
      const distance = Math.abs(columnsLocalX - columnCenter);

      if (distance < nearestDistance) {
        nearestColumnId = column.id;
        nearestDistance = distance;
      }
    }

    return nearestColumnId;
  }

  getAutoScrollTarget(screenX: number) {
    if (this.boardViewportWidth <= 0) return null;

    const leftEdge = this.boardViewportX + AUTO_SCROLL_EDGE_SIZE;
    const rightEdge =
      this.boardViewportX + this.boardViewportWidth - AUTO_SCROLL_EDGE_SIZE;

    if (screenX < leftEdge) {
      return Math.max(0, this.boardScrollX - AUTO_SCROLL_STEP);
    }

    if (screenX > rightEdge) {
      return this.boardScrollX + AUTO_SCROLL_STEP;
    }

    return null;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function arrayMove<T>(items: T[], from: number, to: number) {
  const nextItems = [...items];
  const [item] = nextItems.splice(from, 1);
  nextItems.splice(to, 0, item);
  return nextItems;
}

function animateTaskPreviewLayout() {
  LayoutAnimation.configureNext({
    duration: 120,
    create: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity,
    },
    update: {
      type: LayoutAnimation.Types.easeInEaseOut,
    },
    delete: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity,
    },
  });
}

function taskDragPreviewsAreEqual(
  preview: TaskDragPreview | null,
  nextPreview: TaskDragPreview | null,
) {
  return (
    preview?.taskId === nextPreview?.taskId &&
    preview?.targetColumnId === nextPreview?.targetColumnId &&
    preview?.targetIndex === nextPreview?.targetIndex &&
    preview?.placeholderHeight === nextPreview?.placeholderHeight
  );
}

function getTaskDragPreview(
  taskId: Id,
  deltaX: number,
  deltaY: number,
  columns: Column[],
  tasks: Task[],
  placeholderHeight: number,
  targetColumnId?: Id | null,
): TaskDragPreview | null {
  const task = tasks.find((item) => item.id === taskId);
  if (!task) return null;

  const sourceColumnIndex = columns.findIndex(
    (column) => column.id === task.columnId,
  );
  if (sourceColumnIndex === -1) return null;

  const fallbackTargetColumnIndex = clamp(
    sourceColumnIndex + Math.round(deltaX / (COLUMN_WIDTH + COLUMN_GAP)),
    0,
    columns.length - 1,
  );
  const targetColumn =
    columns.find((column) => column.id === targetColumnId) ??
    columns[fallbackTargetColumnIndex];
  const sourceTasks = tasks.filter((item) => item.columnId === task.columnId);
  const sourceTaskIndex = sourceTasks.findIndex((item) => item.id === taskId);

  if (sourceTaskIndex === -1) return null;

  const targetTasksWithoutDragged = tasks.filter(
    (item) => item.columnId === targetColumn.id && item.id !== taskId,
  );
  const targetTaskIndex = clamp(
    sourceTaskIndex +
      Math.round(deltaY / (Math.max(placeholderHeight, 50) + TASK_GAP)),
    0,
    targetTasksWithoutDragged.length,
  );

  return {
    taskId,
    targetColumnId: targetColumn.id,
    targetIndex: targetTaskIndex,
    placeholderHeight,
  };
}

function moveTaskToPreview(
  taskId: Id,
  columns: Column[],
  tasks: Task[],
  preview: TaskDragPreview,
) {
  const task = tasks.find((item) => item.id === taskId);
  const targetColumn = columns.find(
    (column) => column.id === preview.targetColumnId,
  );

  if (!task || !targetColumn) return tasks;

  const taskToMove = { ...task, columnId: targetColumn.id };
  const remainingTasks = tasks.filter((item) => item.id !== taskId);
  const rebuiltTasks: Task[] = [];

  columns.forEach((column) => {
    const columnTasks = remainingTasks.filter(
      (item) => item.columnId === column.id,
    );

    if (column.id === targetColumn.id) {
      columnTasks.splice(
        clamp(preview.targetIndex, 0, columnTasks.length),
        0,
        taskToMove,
      );
    }

    rebuiltTasks.push(...columnTasks);
  });

  return rebuiltTasks;
}

function KanbanBoard() {
  const [columns, setColumns] = useState<Column[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [editingTaskId, setEditingTaskId] = useState<Id | null>(null);
  const [activeTaskDrag, setActiveTaskDrag] = useState<TaskDragState | null>(
    null,
  );
  const [taskDragPreview, setTaskDragPreview] =
    useState<TaskDragPreview | null>(null);
  const [isTouchingTask, setIsTouchingTask] = useState(false);
  const taskDragOrigin = useRef({ x: 0, y: 0 });
  const activeTaskDragInfo = useRef<{
    taskId: Id;
    placeholderHeight: number;
    startScrollX: number;
    lastEffectiveDeltaX: number;
  } | null>(null);
  const lastTaskDragPreview = useRef<TaskDragPreview | null>(null);
  const boardScrollRef = useRef<ScrollView | null>(null);
  const [boardDragMetrics] = useState(() => new BoardDragMetrics());
  const [taskOverlayPosition] = useState(() => new Animated.ValueXY());
  const [taskOverlayOpacity] = useState(() => new Animated.Value(0));
  const [taskOverlayScale] = useState(() => new Animated.Value(1));
  const [taskOverlayTilt] = useState(() => new Animated.Value(0));

  const tasksByColumn = useMemo(
    () =>
      columns.reduce<Record<string, Task[]>>((acc, column) => {
        acc[String(column.id)] = tasks.filter(
          (task) => task.columnId === column.id,
        );
        return acc;
      }, {}),
    [columns, tasks],
  );

  function generateId() {
    return Math.random().toString(36).substring(2, 10);
  }

  function createColumn() {
    setEditingTaskId(null);

    const columnToAdd: Column = {
      id: generateId(),
      title: `Column ${columns.length + 1}`,
    };
    setColumns([...columns, columnToAdd]);
  }

  function deleteColumn(id: Id) {
    setEditingTaskId(null);

    const filteredColumns = columns.filter((col) => col.id !== id);
    setColumns(filteredColumns);

    const newTasks = tasks.filter((task) => task.columnId !== id);
    setTasks(newTasks);
  }

  function updateColumn(id: Id, title: Column["title"]) {
    const newColumns = columns.map((col) => {
      if (col.id !== id) return col;
      return {
        ...col,
        title,
      };
    });
    setColumns(newColumns);
  }

  function createTask(columnId: Id) {
    setEditingTaskId(null);

    const newTask: Task = {
      id: generateId(),
      columnId,
      content: `Task ${tasks.length + 1}`,
    };
    setTasks([...tasks, newTask]);
  }

  function deleteTask(id: Id) {
    if (editingTaskId === id) {
      setEditingTaskId(null);
    }

    const newTasks = tasks.filter((task) => task.id !== id);
    setTasks(newTasks);
  }

  function updateTask(id: Id, content: Task["content"]) {
    const newTasks = tasks.map((task) => {
      if (task.id !== id) return task;
      return {
        ...task,
        content,
      };
    });
    setTasks(newTasks);
  }

  const moveColumn = useCallback((id: Id, deltaX: number) => {
    setColumns((currentColumns) => {
      const fromIndex = currentColumns.findIndex((column) => column.id === id);
      if (fromIndex === -1) return currentColumns;

      const indexOffset = Math.round(deltaX / (COLUMN_WIDTH + COLUMN_GAP));
      const toIndex = clamp(
        fromIndex + indexOffset,
        0,
        currentColumns.length - 1,
      );

      if (fromIndex === toIndex) return currentColumns;
      return arrayMove(currentColumns, fromIndex, toIndex);
    });
  }, []);

  const updateTaskDragPreview = useCallback((
    taskId: Id,
    deltaX: number,
    deltaY: number,
    placeholderHeight: number,
    targetColumnId?: Id | null,
  ) => {
    const nextPreview = getTaskDragPreview(
      taskId,
      deltaX,
      deltaY,
      columns,
      tasks,
      placeholderHeight,
      targetColumnId,
    );
    lastTaskDragPreview.current = nextPreview;

    setTaskDragPreview((currentPreview) => {
      if (taskDragPreviewsAreEqual(currentPreview, nextPreview)) {
        return currentPreview;
      }

      animateTaskPreviewLayout();
      return nextPreview;
    });
  }, [columns, tasks]);

  const moveTask = useCallback((taskId: Id, deltaX: number, deltaY: number) => {
    const placeholderHeight =
      activeTaskDragInfo.current?.taskId === taskId
        ? activeTaskDragInfo.current.placeholderHeight
        : TASK_HEIGHT;
    const effectiveDeltaX =
      activeTaskDragInfo.current?.taskId === taskId
        ? activeTaskDragInfo.current.lastEffectiveDeltaX
        : deltaX;

    setTasks((currentTasks) => {
      const preview =
        lastTaskDragPreview.current?.taskId === taskId
          ? lastTaskDragPreview.current
          : getTaskDragPreview(
              taskId,
              effectiveDeltaX,
              deltaY,
              columns,
              currentTasks,
              placeholderHeight,
            );
      if (!preview) return currentTasks;

      return moveTaskToPreview(taskId, columns, currentTasks, preview);
    });
  }, [columns]);

  const handleTaskDragStart = useCallback(
    (
      task: Task,
      layout: { x: number; y: number; width: number; height: number },
    ) => {
      setEditingTaskId(null);
      taskDragOrigin.current = { x: layout.x, y: layout.y };
      activeTaskDragInfo.current = {
        taskId: task.id,
        placeholderHeight: layout.height,
        startScrollX: boardDragMetrics.getBoardScrollX(),
        lastEffectiveDeltaX: 0,
      };
      taskOverlayPosition.stopAnimation();
      taskOverlayOpacity.stopAnimation();
      taskOverlayScale.stopAnimation();
      taskOverlayTilt.stopAnimation();
      taskOverlayPosition.setValue({ x: layout.x, y: layout.y });
      taskOverlayOpacity.setValue(0.35);
      taskOverlayScale.setValue(0.98);
      taskOverlayTilt.setValue(0);

      setActiveTaskDrag({
        task,
        width: layout.width,
        height: layout.height,
      });
      updateTaskDragPreview(task.id, 0, 0, layout.height);

      Animated.parallel([
        Animated.timing(taskOverlayOpacity, {
          toValue: 1,
          duration: 90,
          useNativeDriver: true,
        }),
        Animated.spring(taskOverlayScale, {
          toValue: 1.04,
          tension: 260,
          friction: 18,
          useNativeDriver: true,
        }),
      ]).start();
    },
    [
      taskOverlayOpacity,
      taskOverlayPosition,
      taskOverlayScale,
      taskOverlayTilt,
      updateTaskDragPreview,
      boardDragMetrics,
    ],
  );

  const handleTaskDragMove = useCallback((
    deltaX: number,
    deltaY: number,
    pointerX: number,
  ) => {
    const currentDrag = activeTaskDragInfo.current;

    if (currentDrag) {
      const autoScrollTarget =
        boardDragMetrics.getAutoScrollTarget(pointerX);

      if (autoScrollTarget !== null) {
        boardDragMetrics.setBoardScrollX(autoScrollTarget);
        boardScrollRef.current?.scrollTo({
          x: autoScrollTarget,
          animated: false,
        });
      }

      const effectiveDeltaX =
        deltaX +
        boardDragMetrics.getBoardScrollX() -
        currentDrag.startScrollX;
      currentDrag.lastEffectiveDeltaX = effectiveDeltaX;

      const targetColumnId = boardDragMetrics.getTargetColumnId(
        columns,
        pointerX,
      );

      updateTaskDragPreview(
        currentDrag.taskId,
        effectiveDeltaX,
        deltaY,
        currentDrag.placeholderHeight,
        targetColumnId,
      );
    }

    taskOverlayPosition.setValue({
      x: taskDragOrigin.current.x + deltaX,
      y: taskDragOrigin.current.y + deltaY,
    });
    taskOverlayTilt.setValue(deltaX);
  }, [
    boardDragMetrics,
    columns,
    taskOverlayPosition,
    taskOverlayTilt,
    updateTaskDragPreview,
  ]);

  const handleTaskDragEnd = useCallback(() => {
    setIsTouchingTask(false);

    Animated.parallel([
      Animated.timing(taskOverlayOpacity, {
        toValue: 0,
        duration: 110,
        useNativeDriver: true,
      }),
      Animated.spring(taskOverlayScale, {
        toValue: 0.98,
        tension: 220,
        friction: 18,
        useNativeDriver: true,
      }),
      Animated.spring(taskOverlayTilt, {
        toValue: 0,
        tension: 220,
        friction: 18,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        animateTaskPreviewLayout();
        setActiveTaskDrag(null);
        setTaskDragPreview(null);
        activeTaskDragInfo.current = null;
        lastTaskDragPreview.current = null;
      }
    });
  }, [taskOverlayOpacity, taskOverlayScale, taskOverlayTilt]);

  const handleTaskTouchStart = useCallback(() => {
    setIsTouchingTask(true);
  }, []);

  const handleTaskTouchEnd = useCallback(() => {
    setIsTouchingTask(false);
  }, []);

  const handleColumnLayout = useCallback((
    id: Id,
    layout: { x: number; width: number },
  ) => {
    boardDragMetrics.setColumnLayout(id, layout);
  }, [boardDragMetrics]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        ref={boardScrollRef}
        horizontal
        style={styles.boardScroll}
        scrollEnabled={!isTouchingTask}
        directionalLockEnabled
        contentContainerStyle={styles.board}
        keyboardShouldPersistTaps="handled"
        onLayout={(event) => {
          const { x, width } = event.nativeEvent.layout;
          boardDragMetrics.setBoardViewportLayout(x, width);
        }}
        onScrollBeginDrag={() => setEditingTaskId(null)}
        onScroll={(event) => {
          boardDragMetrics.setBoardScrollX(
            event.nativeEvent.contentOffset.x,
          );
        }}
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
      >
        <View
          style={styles.columns}
          onLayout={(event) => {
            boardDragMetrics.setColumnsContainerX(
              event.nativeEvent.layout.x,
            );
          }}
        >
          {columns.map((col) => (
            <ColumnContainer
              key={col.id}
              column={col}
              deleteColumn={deleteColumn}
              updateColumn={updateColumn}
              createTask={createTask}
              deleteTask={deleteTask}
              updateTask={updateTask}
              moveColumn={moveColumn}
              moveTask={moveTask}
              onTaskDragStart={handleTaskDragStart}
              onTaskDragMove={handleTaskDragMove}
              onTaskDragEnd={handleTaskDragEnd}
              onTaskTouchStart={handleTaskTouchStart}
              onTaskTouchEnd={handleTaskTouchEnd}
              onColumnLayout={handleColumnLayout}
              editingTaskId={editingTaskId}
              setEditingTaskId={setEditingTaskId}
              taskDragPreview={
                taskDragPreview?.targetColumnId === col.id
                  ? taskDragPreview
                  : null
              }
              draggingTaskId={activeTaskDrag?.task.id ?? null}
              tasks={tasksByColumn[String(col.id)] ?? []}
            />
          ))}
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={createColumn}
            style={styles.addColumnButton}
          >
            <Text style={styles.addIcon}>+</Text>
            <Text style={styles.addColumnText}>Add Column</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      <View pointerEvents="none" style={styles.dragOverlay}>
        {activeTaskDrag && (
          <Animated.View
            style={[
              styles.draggedTask,
              {
                width: activeTaskDrag.width,
                height: activeTaskDrag.height,
                opacity: taskOverlayOpacity,
                transform: [
                  ...taskOverlayPosition.getTranslateTransform(),
                  {
                    rotateZ: taskOverlayTilt.interpolate({
                      inputRange: [-160, 0, 160],
                      outputRange: ["-3deg", "0deg", "3deg"],
                      extrapolate: "clamp",
                    }),
                  },
                  { scale: taskOverlayScale },
                ],
              },
            ]}
          >
            <TaskCard
              task={activeTaskDrag.task}
              deleteTask={deleteTask}
              updateTask={updateTask}
              moveTask={moveTask}
              isEditing={false}
              isOverlay
              setEditingTaskId={setEditingTaskId}
            />
          </Animated.View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    position: "relative",
    backgroundColor: "#000000",
  },
  boardScroll: {
    flex: 1,
  },
  board: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
  },
  columns: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: COLUMN_GAP,
  },
  addColumnButton: {
    width: COLUMN_WIDTH,
    minWidth: COLUMN_WIDTH,
    height: 60,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    padding: 16,
    borderWidth: 2,
    borderColor: "#161c22",
    borderRadius: 8,
    backgroundColor: "#0d1117",
  },
  addIcon: {
    color: "#ffffff",
    fontSize: 28,
    lineHeight: 28,
  },
  addColumnText: {
    color: "#ffffff",
    fontSize: 16,
  },
  dragOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 99999,
    elevation: 99999,
    overflow: "visible",
  },

  draggedTask: {
    position: "absolute",
    left: 0,
    top: 0,
    zIndex: 99999,
    elevation: 99999,
  },
});

export default KanbanBoard;
