import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type {
  Column,
  ColumnScrollMetrics,
  Id,
  Task,
  TaskDragLayout,
  TaskListItemLayout,
} from "../types";
import ColumnContainer from "./ColumnContainer";
import TaskCard from "./TaskCard";

const COLUMN_WIDTH = 250;
const COLUMN_GAP = 16;
const TASK_HEIGHT = 100;
const TASK_GAP = 16;
const AUTO_SCROLL_EDGE_SIZE = 30;
const VERTICAL_AUTO_SCROLL_EDGE_SIZE = 56;
const VERTICAL_AUTO_SCROLL_MIN_STEP = 2;
const VERTICAL_AUTO_SCROLL_MAX_STEP = 22;
const TASKS_CONTENT_PADDING = 8;
const BOARD_STORAGE_KEY = "@kanban-mobile/board-state";

type PersistedBoardState = {
  columns: Column[];
  tasks: Task[];
};

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isId(value: unknown): value is Id {
  return typeof value === "string" || typeof value === "number";
}

function isPersistedColumn(value: unknown): value is Column {
  return isRecord(value) && isId(value.id) && typeof value.title === "string";
}

function isPersistedTask(value: unknown): value is Task {
  return (
    isRecord(value) &&
    isId(value.id) &&
    isId(value.columnId) &&
    typeof value.content === "string"
  );
}

function parsePersistedBoardState(
  value: string | null,
): PersistedBoardState | null {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);

    if (
      !isRecord(parsed) ||
      !Array.isArray(parsed.columns) ||
      !Array.isArray(parsed.tasks)
    ) {
      return null;
    }

    const columns = parsed.columns.filter(isPersistedColumn);
    const columnIds = new Set(columns.map((column) => String(column.id)));
    const tasks = parsed.tasks.filter(
      (task): task is Task =>
        isPersistedTask(task) && columnIds.has(String(task.columnId)),
    );

    return { columns, tasks };
  } catch {
    return null;
  }
}

class BoardDragMetrics {
  private boardScrollX = 0;
  private boardViewportX = 0;
  private boardViewportWidth = 0;
  private columnsContainerX = 0;
  private columnLayouts = new Map<string, ColumnLayout>();
  private columnScrollMetrics = new Map<string, ColumnScrollMetrics>();
  private columnTaskLayouts = new Map<string, TaskListItemLayout[]>();

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

  setColumnScrollMetrics(id: Id, metrics: ColumnScrollMetrics) {
    this.columnScrollMetrics.set(String(id), metrics);
  }

  setColumnScrollY(id: Id, scrollY: number) {
    const metrics = this.columnScrollMetrics.get(String(id));
    if (!metrics) return;

    metrics.scrollY = scrollY;
  }

  setColumnTaskLayouts(id: Id, layouts: TaskListItemLayout[]) {
    this.columnTaskLayouts.set(String(id), layouts);
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

    const MIN_SCROLL = 2;
    const MAX_SCROLL = 18;

    if (screenX < leftEdge) {
      const distance = leftEdge - screenX;

      const speed = Math.min(MAX_SCROLL, MIN_SCROLL + distance * 0.25);

      return Math.max(0, this.boardScrollX - speed);
    }

    if (screenX > rightEdge) {
      const distance = screenX - rightEdge;

      const speed = Math.min(MAX_SCROLL, MIN_SCROLL + distance * 0.25);

      return this.boardScrollX + speed;
    }

    return null;
  }

  getTargetTaskIndex(
    columnId: Id,
    pointerY: number,
    placeholderHeight: number,
    taskCount: number,
  ) {
    const metrics = this.columnScrollMetrics.get(String(columnId));
    if (!metrics || metrics.viewportHeight <= 0) return null;

    const pointerContentY =
      pointerY - metrics.windowY + metrics.scrollY - TASKS_CONTENT_PADDING;
    const taskLayouts = this.columnTaskLayouts.get(String(columnId)) ?? [];

    if (taskLayouts.length > 0) {
      const layoutIndex = taskLayouts.findIndex(
        (layout) => pointerContentY < layout.y + layout.height / 2,
      );

      if (layoutIndex === -1) {
        return clamp(taskLayouts.length, 0, taskCount);
      }

      return clamp(layoutIndex, 0, taskCount);
    }

    const slotHeight = Math.max(placeholderHeight, 50) + TASK_GAP;

    return clamp(Math.round(pointerContentY / slotHeight), 0, taskCount);
  }

  getVerticalAutoScrollTarget(columnId: Id, pointerY: number) {
    const metrics = this.columnScrollMetrics.get(String(columnId));
    if (!metrics || metrics.viewportHeight <= 0) return null;

    const maxScrollY = Math.max(
      0,
      metrics.contentHeight - metrics.viewportHeight,
    );
    if (maxScrollY <= 0) return null;

    const topDistance = pointerY - metrics.windowY;
    const bottomDistance = metrics.windowY + metrics.viewportHeight - pointerY;

    if (topDistance < VERTICAL_AUTO_SCROLL_EDGE_SIZE) {
      const intensity = clamp(
        (VERTICAL_AUTO_SCROLL_EDGE_SIZE - topDistance) /
          VERTICAL_AUTO_SCROLL_EDGE_SIZE,
        0,
        1,
      );
      const speed =
        VERTICAL_AUTO_SCROLL_MIN_STEP +
        (VERTICAL_AUTO_SCROLL_MAX_STEP - VERTICAL_AUTO_SCROLL_MIN_STEP) *
          intensity *
          intensity;
      const scrollY = clamp(metrics.scrollY - speed, 0, maxScrollY);

      if (scrollY !== metrics.scrollY) {
        return { scrollY };
      }
    }

    if (bottomDistance < VERTICAL_AUTO_SCROLL_EDGE_SIZE) {
      const intensity = clamp(
        (VERTICAL_AUTO_SCROLL_EDGE_SIZE - bottomDistance) /
          VERTICAL_AUTO_SCROLL_EDGE_SIZE,
        0,
        1,
      );
      const speed =
        VERTICAL_AUTO_SCROLL_MIN_STEP +
        (VERTICAL_AUTO_SCROLL_MAX_STEP - VERTICAL_AUTO_SCROLL_MIN_STEP) *
          intensity *
          intensity;
      const scrollY = clamp(metrics.scrollY + speed, 0, maxScrollY);

      if (scrollY !== metrics.scrollY) {
        return { scrollY };
      }
    }

    return null;
  }

  scrollColumnTo(columnId: Id, scrollY: number) {
    const metrics = this.columnScrollMetrics.get(String(columnId));
    if (!metrics) return;

    metrics.scrollY = scrollY;
    metrics.scrollTo(scrollY);
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

function triggerHaptic(feedback: () => Promise<void>) {
  void feedback().catch(() => undefined);
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
  targetIndexOverride?: number | null,
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
  const targetTaskIndex =
    targetIndexOverride !== null && targetIndexOverride !== undefined
      ? clamp(targetIndexOverride, 0, targetTasksWithoutDragged.length)
      : clamp(
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
  const [hasLoadedStoredBoard, setHasLoadedStoredBoard] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<Id | null>(null);
  const [activeTaskDrag, setActiveTaskDrag] = useState<TaskDragState | null>(
    null,
  );
  const [taskDragPreview, setTaskDragPreview] =
    useState<TaskDragPreview | null>(null);
  const [isTouchingTask, setIsTouchingTask] = useState(false);
  const activeTaskDragInfo = useRef<{
    taskId: Id;
    placeholderHeight: number;
    touchOffsetX: number;
    touchOffsetY: number;
    startScrollX: number;
    lastEffectiveDeltaX: number;
  } | null>(null);
  const lastTaskDragPreview = useRef<TaskDragPreview | null>(null);
  const latestDragPointer = useRef<{
    deltaX: number;
    deltaY: number;
    pointerX: number;
    pointerY: number;
  } | null>(null);
  const autoScrollFrame = useRef<ReturnType<
    typeof requestAnimationFrame
  > | null>(null);
  const lastHapticColumnId = useRef<Id | null>(null);
  const lastColumnHapticAt = useRef(0);
  const boardScrollRef = useRef<ScrollView | null>(null);
  const [boardDragMetrics] = useState(() => new BoardDragMetrics());
  const [taskOverlayPosition] = useState(() => new Animated.ValueXY());
  const [taskOverlayOpacity] = useState(() => new Animated.Value(0));
  const [taskOverlayScale] = useState(() => new Animated.Value(1));
  const [taskOverlayTilt] = useState(() => new Animated.Value(0));

  useEffect(() => {
    let isMounted = true;

    async function loadBoard() {
      try {
        const storedBoard = parsePersistedBoardState(
          await AsyncStorage.getItem(BOARD_STORAGE_KEY),
        );

        if (!isMounted) return;

        if (storedBoard) {
          setColumns(storedBoard.columns);
          setTasks(storedBoard.tasks);
        }
      } catch (error) {
        console.warn("Unable to load saved board", error);
      } finally {
        if (isMounted) {
          setHasLoadedStoredBoard(true);
        }
      }
    }

    void loadBoard();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedStoredBoard) return;

    const boardState: PersistedBoardState = { columns, tasks };

    AsyncStorage.setItem(BOARD_STORAGE_KEY, JSON.stringify(boardState)).catch(
      (error: unknown) => {
        console.warn("Unable to save board", error);
      },
    );
  }, [columns, hasLoadedStoredBoard, tasks]);

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

    setColumns((currentColumns) => [
      ...currentColumns,
      {
        id: generateId(),
        title: `Column ${currentColumns.length + 1}`,
      },
    ]);
  }

  function deleteColumn(id: Id) {
    setEditingTaskId(null);

    setColumns((currentColumns) =>
      currentColumns.filter((column) => column.id !== id),
    );
    setTasks((currentTasks) =>
      currentTasks.filter((task) => task.columnId !== id),
    );
  }

  function updateColumn(id: Id, title: Column["title"]) {
    setColumns((currentColumns) =>
      currentColumns.map((column) => {
        if (column.id !== id) return column;
        return {
          ...column,
          title,
        };
      }),
    );
  }

  function createTask(columnId: Id) {
    setEditingTaskId(null);

    setTasks((currentTasks) => [
      ...currentTasks,
      {
        id: generateId(),
        columnId,
        content: `Task ${currentTasks.length + 1}`,
      },
    ]);
  }

  function deleteTask(id: Id) {
    if (editingTaskId === id) {
      setEditingTaskId(null);
    }

    setTasks((currentTasks) => currentTasks.filter((task) => task.id !== id));
  }

  function updateTask(id: Id, content: Task["content"]) {
    setTasks((currentTasks) =>
      currentTasks.map((task) => {
        if (task.id !== id) return task;
        return {
          ...task,
          content,
        };
      }),
    );
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

  const updateTaskDragPreview = useCallback(
    (
      taskId: Id,
      deltaX: number,
      deltaY: number,
      placeholderHeight: number,
      targetColumnId?: Id | null,
      targetIndexOverride?: number | null,
    ) => {
      const nextPreview = getTaskDragPreview(
        taskId,
        deltaX,
        deltaY,
        columns,
        tasks,
        placeholderHeight,
        targetColumnId,
        targetIndexOverride,
      );
      lastTaskDragPreview.current = nextPreview;

      if (
        nextPreview &&
        lastHapticColumnId.current !== null &&
        String(nextPreview.targetColumnId) !==
          String(lastHapticColumnId.current)
      ) {
        const now = Date.now();

        if (now - lastColumnHapticAt.current > 120) {
          lastColumnHapticAt.current = now;
          triggerHaptic(() => Haptics.selectionAsync());
        }
      }

      if (nextPreview) {
        lastHapticColumnId.current = nextPreview.targetColumnId;
      }

      setTaskDragPreview((currentPreview) => {
        if (taskDragPreviewsAreEqual(currentPreview, nextPreview)) {
          return currentPreview;
        }

        return nextPreview;
      });
    },
    [columns, tasks],
  );

  const moveTask = useCallback(
    (taskId: Id, deltaX: number, deltaY: number) => {
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
    },
    [columns],
  );

  const stopAutoScrollLoop = useCallback(() => {
    if (autoScrollFrame.current !== null) {
      cancelAnimationFrame(autoScrollFrame.current);
      autoScrollFrame.current = null;
    }
  }, []);

  useEffect(() => stopAutoScrollLoop, [stopAutoScrollLoop]);

  const updateDragFromPointer = useCallback(
    (deltaX: number, deltaY: number, pointerX: number, pointerY: number) => {
      const currentDrag = activeTaskDragInfo.current;

      if (!currentDrag) return false;

      let didAutoScroll = false;

      const horizontalAutoScrollTarget =
        boardDragMetrics.getAutoScrollTarget(pointerX);

      if (horizontalAutoScrollTarget !== null) {
        boardDragMetrics.setBoardScrollX(horizontalAutoScrollTarget);

        boardScrollRef.current?.scrollTo({
          x: horizontalAutoScrollTarget,
          animated: false,
        });

        didAutoScroll = true;
      }

      const effectiveDeltaX =
        deltaX + boardDragMetrics.getBoardScrollX() - currentDrag.startScrollX;

      currentDrag.lastEffectiveDeltaX = effectiveDeltaX;

      const targetColumnId = boardDragMetrics.getTargetColumnId(
        columns,
        pointerX,
      );

      if (targetColumnId !== null) {
        const verticalAutoScrollTarget =
          boardDragMetrics.getVerticalAutoScrollTarget(
            targetColumnId,
            pointerY,
          );

        if (verticalAutoScrollTarget !== null) {
          boardDragMetrics.scrollColumnTo(
            targetColumnId,
            verticalAutoScrollTarget.scrollY,
          );

          didAutoScroll = true;
        }
      }

      const targetTaskCount =
        targetColumnId === null
          ? 0
          : tasks.filter(
              (task) =>
                task.columnId === targetColumnId &&
                task.id !== currentDrag.taskId,
            ).length;

      const targetIndex =
        targetColumnId === null
          ? null
          : boardDragMetrics.getTargetTaskIndex(
              targetColumnId,
              pointerY,
              currentDrag.placeholderHeight,
              targetTaskCount,
            );

      updateTaskDragPreview(
        currentDrag.taskId,
        effectiveDeltaX,
        deltaY,
        currentDrag.placeholderHeight,
        targetColumnId,
        targetIndex,
      );

      // movimento preso no dedo
      taskOverlayPosition.setValue({
        x: pointerX - currentDrag.touchOffsetX,
        y: pointerY - currentDrag.touchOffsetY,
      });

      taskOverlayTilt.setValue(effectiveDeltaX);

      return didAutoScroll;
    },
    [
      boardDragMetrics,
      columns,
      taskOverlayPosition,
      taskOverlayTilt,
      tasks,
      updateTaskDragPreview,
    ],
  );

  const scheduleAutoScrollLoop = useCallback(() => {
    if (autoScrollFrame.current !== null) return;

    autoScrollFrame.current = requestAnimationFrame(function tick() {
      autoScrollFrame.current = null;

      const latestPointer = latestDragPointer.current;
      if (!latestPointer || !activeTaskDragInfo.current) return;

      const didAutoScroll = updateDragFromPointer(
        latestPointer.deltaX,
        latestPointer.deltaY,
        latestPointer.pointerX,
        latestPointer.pointerY,
      );

      if (didAutoScroll && activeTaskDragInfo.current) {
        autoScrollFrame.current = requestAnimationFrame(tick);
      }
    });
  }, [updateDragFromPointer]);

  const handleTaskDragStart = useCallback(
    (task: Task, layout: TaskDragLayout) => {
      setEditingTaskId(null);
      stopAutoScrollLoop();
      latestDragPointer.current = null;
      lastHapticColumnId.current = task.columnId;
      lastColumnHapticAt.current = Date.now();
      activeTaskDragInfo.current = {
        taskId: task.id,
        placeholderHeight: layout.height,
        touchOffsetX: layout.touchOffsetX,
        touchOffsetY: layout.touchOffsetY,
        startScrollX: boardDragMetrics.getBoardScrollX(),
        lastEffectiveDeltaX: 0,
      };
      taskOverlayPosition.stopAnimation();
      taskOverlayOpacity.stopAnimation();
      taskOverlayScale.stopAnimation();
      taskOverlayTilt.stopAnimation();
      taskOverlayPosition.setValue({ x: layout.x, y: layout.y });
      taskOverlayOpacity.setValue(0.35);
      taskOverlayScale.setValue(0.96);
      taskOverlayTilt.setValue(0);
      triggerHaptic(() =>
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
      );

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
          toValue: 1.015,
          tension: 120,
          friction: 22,
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
      stopAutoScrollLoop,
    ],
  );

  const handleTaskDragMove = useCallback(
    (deltaX: number, deltaY: number, pointerX: number, pointerY: number) => {
      latestDragPointer.current = { deltaX, deltaY, pointerX, pointerY };

      const didAutoScroll = updateDragFromPointer(
        deltaX,
        deltaY,
        pointerX,
        pointerY,
      );

      if (didAutoScroll) {
        scheduleAutoScrollLoop();
      }
    },
    [scheduleAutoScrollLoop, updateDragFromPointer],
  );

  const handleTaskDragEnd = useCallback(
    (dropAccepted: boolean) => {
      setIsTouchingTask(false);
      stopAutoScrollLoop();
      latestDragPointer.current = null;

      if (dropAccepted) {
        triggerHaptic(() =>
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
        );
      }

      Animated.parallel([
        Animated.timing(taskOverlayOpacity, {
          toValue: 0,
          duration: 130,
          useNativeDriver: true,
        }),
        Animated.spring(taskOverlayScale, {
          toValue: 1,
          tension: 110,
          friction: 24,
          useNativeDriver: true,
        }),
        Animated.spring(taskOverlayTilt, {
          toValue: 0,
          tension: 110,
          friction: 24,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) {
          setActiveTaskDrag(null);
          setTaskDragPreview(null);
          activeTaskDragInfo.current = null;
          lastTaskDragPreview.current = null;
          lastHapticColumnId.current = null;
        }
      });
    },
    [stopAutoScrollLoop, taskOverlayOpacity, taskOverlayScale, taskOverlayTilt],
  );

  const handleTaskTouchStart = useCallback(() => {
    setIsTouchingTask(true);
  }, []);

  const handleTaskTouchEnd = useCallback(() => {
    setIsTouchingTask(false);
  }, []);

  const handleColumnLayout = useCallback(
    (id: Id, layout: { x: number; width: number }) => {
      boardDragMetrics.setColumnLayout(id, layout);
    },
    [boardDragMetrics],
  );

  const handleColumnScrollMetricsChange = useCallback(
    (id: Id, metrics: ColumnScrollMetrics) => {
      boardDragMetrics.setColumnScrollMetrics(id, metrics);
    },
    [boardDragMetrics],
  );

  const handleColumnScrollYChange = useCallback(
    (id: Id, scrollY: number) => {
      boardDragMetrics.setColumnScrollY(id, scrollY);
    },
    [boardDragMetrics],
  );

  const handleColumnTaskLayoutsChange = useCallback(
    (id: Id, layouts: TaskListItemLayout[]) => {
      boardDragMetrics.setColumnTaskLayouts(id, layouts);
    },
    [boardDragMetrics],
  );

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
          boardDragMetrics.setBoardScrollX(event.nativeEvent.contentOffset.x);
        }}
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
      >
        <View
          style={styles.columns}
          onLayout={(event) => {
            boardDragMetrics.setColumnsContainerX(event.nativeEvent.layout.x);
          }}
        >
          {columns.map((col) => {
            const isDropTarget =
              activeTaskDrag !== null &&
              taskDragPreview?.targetColumnId === col.id;

            return (
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
                onColumnScrollMetricsChange={handleColumnScrollMetricsChange}
                onColumnScrollYChange={handleColumnScrollYChange}
                onColumnTaskLayoutsChange={handleColumnTaskLayoutsChange}
                editingTaskId={editingTaskId}
                setEditingTaskId={setEditingTaskId}
                taskDragPreview={isDropTarget ? taskDragPreview : null}
                draggingTaskId={activeTaskDrag?.task.id ?? null}
                isTaskDragActive={activeTaskDrag !== null}
                isDropTarget={isDropTarget}
                tasks={tasksByColumn[String(col.id)] ?? []}
              />
            );
          })}
          <TouchableOpacity
            activeOpacity={0.8}
            accessibilityLabel="Add column"
            accessibilityRole="button"
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
                      outputRange: ["-1deg", "0deg", "1deg"],
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
