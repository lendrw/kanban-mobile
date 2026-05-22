import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import CheckIcon from "../icons/CheckIcon";
import CloseIcon from "../icons/CloseIcon";
import ZoomInIcon from "../icons/ZoomInIcon";
import ZoomOutIcon from "../icons/ZoomOutIcon";
import type {
  Column,
  ColumnScrollMetrics,
  Id,
  Task,
  TaskDragLayout,
  TaskListItemLayout,
} from "../types";
import CardDetailsScreen from "./CardDetailsScreen";
import ColumnContainer from "./ColumnContainer";
import TaskCard from "./TaskCard";

const TASK_HEIGHT = 100;
const AUTO_SCROLL_EDGE_SIZE = 30;
const VERTICAL_AUTO_SCROLL_EDGE_SIZE = 56;
const VERTICAL_AUTO_SCROLL_MIN_STEP = 2;
const VERTICAL_AUTO_SCROLL_MAX_STEP = 22;
const BOARD_STORAGE_KEY = "@kanban-mobile/board-state";
const ZOOM_LAYOUT_ANIMATION_LOCK_MS = 180;

type BoardDensityLayout = {
  columnWidth: number;
  columnGap: number;
  taskGap: number;
  taskMinHeight: number;
  taskListPadding: number;
  boardPaddingHorizontal: number;
  boardPaddingVertical: number;
  addColumnHeight: number;
  addColumnPadding: number;
  addColumnTextSize: number;
  addColumnIconSize: number;
};

const NORMAL_BOARD_LAYOUT: BoardDensityLayout = {
  columnWidth: 250,
  columnGap: 16,
  taskGap: 12,
  taskMinHeight: 30,
  taskListPadding: 8,
  boardPaddingHorizontal: 40,
  boardPaddingVertical: 40,
  addColumnHeight: 60,
  addColumnPadding: 16,
  addColumnTextSize: 16,
  addColumnIconSize: 28,
};

const ZOOMED_OUT_BOARD_LAYOUT: BoardDensityLayout = {
  columnWidth: 180,
  columnGap: 10,
  taskGap: 8,
  taskMinHeight: 26,
  taskListPadding: 6,
  boardPaddingHorizontal: 18,
  boardPaddingVertical: 18,
  addColumnHeight: 48,
  addColumnPadding: 10,
  addColumnTextSize: 13,
  addColumnIconSize: 22,
};

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

type DropTaskAnimation = {
  taskId: Id;
  fromX: number;
  fromY: number;
  nonce: number;
};

type AddTaskDraft = {
  columnId: Id;
  title: string;
};

type AddColumnDraft = {
  title: string;
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
    typeof value.content === "string" &&
    (value.description === undefined || typeof value.description === "string")
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
    const columnIds = new Set(columns.map((column) => column.id));
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
  private boardScrollY = 0;
  private boardViewportX = 0;
  private boardViewportY = 0;
  private boardViewportWidth = 0;
  private boardViewportHeight = 0;
  private boardContentHeight = 0;
  private columnsContainerX = 0;
  private columnLayouts = new Map<string, ColumnLayout>();
  private columnScrollMetrics = new Map<string, ColumnScrollMetrics>();
  private columnTaskLayouts = new Map<string, TaskListItemLayout[]>();

  setBoardScrollX(scrollX: number) {
    this.boardScrollX = scrollX;
  }

  setBoardScrollY(scrollY: number) {
    const deltaY = scrollY - this.boardScrollY;
    this.boardScrollY = scrollY;

    if (deltaY === 0) return;

    this.columnScrollMetrics.forEach((metrics) => {
      metrics.windowY -= deltaY;
    });
  }

  setBoardViewportLayout(x: number, width: number) {
    this.boardViewportX = x;
    this.boardViewportWidth = width;
  }

  setBoardVerticalViewportLayout(y: number, height: number) {
    this.boardViewportY = y;
    this.boardViewportHeight = height;
  }

  setBoardContentHeight(height: number) {
    this.boardContentHeight = height;
  }

  getBoardScrollX() {
    return this.boardScrollX;
  }

  getBoardScrollY() {
    return this.boardScrollY;
  }

  setColumnsContainerX(x: number) {
    this.columnsContainerX = x;
  }

  setColumnLayout(id: Id, layout: ColumnLayout) {
    this.columnLayouts.set(id, layout);
  }

  setColumnScrollMetrics(id: Id, metrics: ColumnScrollMetrics) {
    this.columnScrollMetrics.set(id, metrics);
  }

  setColumnScrollY(id: Id, scrollY: number) {
    const metrics = this.columnScrollMetrics.get(id);
    if (!metrics) return;

    metrics.scrollY = scrollY;
  }

  setColumnTaskLayouts(id: Id, layouts: TaskListItemLayout[]) {
    this.columnTaskLayouts.set(id, layouts);
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
      const layout = this.columnLayouts.get(column.id);
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

  getBoardVerticalAutoScrollTarget(pointerY: number) {
    if (this.boardViewportHeight <= 0) return null;

    const maxScrollY = Math.max(
      0,
      this.boardContentHeight - this.boardViewportHeight,
    );
    if (maxScrollY <= 0) return null;

    const topEdge = this.boardViewportY + VERTICAL_AUTO_SCROLL_EDGE_SIZE;
    const bottomEdge =
      this.boardViewportY +
      this.boardViewportHeight -
      VERTICAL_AUTO_SCROLL_EDGE_SIZE;

    if (pointerY < topEdge) {
      const intensity = clamp(
        (topEdge - pointerY) / VERTICAL_AUTO_SCROLL_EDGE_SIZE,
        0,
        1,
      );
      return clamp(
        this.boardScrollY -
          (VERTICAL_AUTO_SCROLL_MIN_STEP +
            (VERTICAL_AUTO_SCROLL_MAX_STEP - VERTICAL_AUTO_SCROLL_MIN_STEP) *
              intensity *
              intensity),
        0,
        maxScrollY,
      );
    }

    if (pointerY > bottomEdge) {
      const intensity = clamp(
        (pointerY - bottomEdge) / VERTICAL_AUTO_SCROLL_EDGE_SIZE,
        0,
        1,
      );
      return clamp(
        this.boardScrollY +
          (VERTICAL_AUTO_SCROLL_MIN_STEP +
            (VERTICAL_AUTO_SCROLL_MAX_STEP - VERTICAL_AUTO_SCROLL_MIN_STEP) *
              intensity *
              intensity),
        0,
        maxScrollY,
      );
    }

    return null;
  }

  getTargetTaskIndex(
    columnId: Id,
    pointerY: number,
    placeholderHeight: number,
    taskCount: number,
    taskGap: number,
    taskMinHeight: number,
    taskListPadding: number,
  ) {
    const metrics = this.columnScrollMetrics.get(columnId);
    if (!metrics || metrics.viewportHeight <= 0) return null;

    const pointerContentY =
      pointerY - metrics.windowY + metrics.scrollY - taskListPadding;
    const taskLayouts = this.columnTaskLayouts.get(columnId) ?? [];

    if (taskLayouts.length > 0) {
      const layoutIndex = taskLayouts.findIndex(
        (layout) => pointerContentY < layout.y + layout.height / 2,
      );

      if (layoutIndex === -1) {
        return clamp(taskLayouts.length, 0, taskCount);
      }

      return clamp(layoutIndex, 0, taskCount);
    }

    const slotHeight = Math.max(placeholderHeight, taskMinHeight) + taskGap;

    return clamp(Math.round(pointerContentY / slotHeight), 0, taskCount);
  }

  getVerticalAutoScrollTarget(columnId: Id, pointerY: number) {
    const metrics = this.columnScrollMetrics.get(columnId);
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
    const metrics = this.columnScrollMetrics.get(columnId);
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
  columnStep: number,
  taskGap: number,
  taskMinHeight: number,
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
    sourceColumnIndex + Math.round(deltaX / columnStep),
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
            Math.round(
              deltaY / (Math.max(placeholderHeight, taskMinHeight) + taskGap),
            ),
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
  const [addTaskDraft, setAddTaskDraft] = useState<AddTaskDraft | null>(null);
  const [addColumnDraft, setAddColumnDraft] =
    useState<AddColumnDraft | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<Id | null>(null);
  const [isZoomedOut, setIsZoomedOut] = useState(false);
  const [shouldAnimateTaskLayout, setShouldAnimateTaskLayout] = useState(true);
  const [activeTaskDrag, setActiveTaskDrag] = useState<TaskDragState | null>(
    null,
  );
  const [taskDragPreview, setTaskDragPreview] =
    useState<TaskDragPreview | null>(null);
  const [hiddenDraggingTaskId, setHiddenDraggingTaskId] =
    useState<Id | null>(null);
  const [dropTaskAnimation, setDropTaskAnimation] =
    useState<DropTaskAnimation | null>(null);
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
  const boardVerticalScrollRef = useRef<ScrollView | null>(null);
  const boardScrollRef = useRef<ScrollView | null>(null);
  const dropTaskAnimationNonce = useRef(0);
  const taskOverlayLayoutRef = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const boardHorizontalScrollXRef = useRef(0);
  const boardHorizontalViewportWidthRef = useRef(0);
  const boardHorizontalContentWidthRef = useRef(0);
  const boardDragMetrics = useRef(new BoardDragMetrics()).current;
  const [taskOverlayPosition] = useState(() => new Animated.ValueXY());
  const [taskOverlayOpacity] = useState(() => new Animated.Value(0));
  const [taskOverlayScale] = useState(() => new Animated.Value(1));
  const [taskOverlayTilt] = useState(() => new Animated.Value(0));
  const boardLayout = isZoomedOut
    ? ZOOMED_OUT_BOARD_LAYOUT
    : NORMAL_BOARD_LAYOUT;
  const columnStep = boardLayout.columnWidth + boardLayout.columnGap;
  const boardLayoutRef = useRef(boardLayout);
  boardLayoutRef.current = boardLayout;
  const columnStepRef = useRef(columnStep);
  columnStepRef.current = columnStep;

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

  const scrollBoardHorizontallyToEnd = useCallback((animated = false) => {
    const viewportWidth = boardHorizontalViewportWidthRef.current;
    const contentWidth = boardHorizontalContentWidthRef.current;

    if (viewportWidth <= 0 || contentWidth <= 0) {
      boardScrollRef.current?.scrollToEnd({ animated });
      return;
    }

    const nextScrollX = Math.max(0, contentWidth - viewportWidth);

    if (!animated && Math.abs(nextScrollX - boardHorizontalScrollXRef.current) < 1) return;

    boardHorizontalScrollXRef.current = nextScrollX;
    boardDragMetrics.setBoardScrollX(nextScrollX);
    boardScrollRef.current?.scrollTo({ x: nextScrollX, animated });
  }, [boardDragMetrics]);

  useEffect(() => {
    if (shouldAnimateTaskLayout) return;

    const animationTimeout = setTimeout(() => {
      setShouldAnimateTaskLayout(true);
    }, ZOOM_LAYOUT_ANIMATION_LOCK_MS);

    return () => {
      clearTimeout(animationTimeout);
    };
  }, [shouldAnimateTaskLayout]);

  const tasksByColumn = useMemo(
    () =>
      columns.reduce<Record<string, Task[]>>((acc, column) => {
        acc[column.id] = tasks.filter(
          (task) => task.columnId === column.id,
        );
        return acc;
      }, {}),
    [columns, tasks],
  );
  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks],
  );

  useEffect(() => {
    if (selectedTaskId !== null && selectedTask === null) {
      setSelectedTaskId(null);
    }
  }, [selectedTask, selectedTaskId]);

  function generateId() {
    return Math.random().toString(36).substring(2, 10);
  }

  function startAddingColumn() {
    setSelectedTaskId(null);
    setAddTaskDraft(null);
    scrollBoardHorizontallyToEnd();
    setAddColumnDraft({ title: "" });
  }

  function updateAddColumnTitle(title: string) {
    setAddColumnDraft((currentDraft) => {
      if (!currentDraft) return currentDraft;

      return {
        ...currentDraft,
        title,
      };
    });
  }

  function cancelAddingColumn() {
    setAddColumnDraft(null);
  }

  function confirmAddingColumn() {
    const title = addColumnDraft?.title.trim();

    if (!addColumnDraft || !title) return;

    setColumns((currentColumns) => [
      ...currentColumns,
      {
        id: generateId(),
        title,
      },
    ]);
    setAddColumnDraft(null);
  }

  function deleteColumn(id: Id) {
    setAddTaskDraft((currentDraft) =>
      currentDraft?.columnId === id ? null : currentDraft,
    );

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

  function startAddingTask(columnId: Id) {
    setSelectedTaskId(null);
    setAddColumnDraft(null);
    setAddTaskDraft({ columnId, title: "" });
  }

  function updateAddTaskTitle(title: string) {
    setAddTaskDraft((currentDraft) => {
      if (!currentDraft) return currentDraft;

      return {
        ...currentDraft,
        title,
      };
    });
  }

  function cancelAddingTask() {
    setAddTaskDraft(null);
  }

  function confirmAddingTask() {
    const title = addTaskDraft?.title.trim();

    if (!addTaskDraft || !title) return;

    setTasks((currentTasks) => [
      ...currentTasks,
      {
        id: generateId(),
        columnId: addTaskDraft.columnId,
        content: title,
      },
    ]);
    setAddTaskDraft(null);
  }

  function deleteTask(id: Id) {
    setSelectedTaskId((currentId) => (currentId === id ? null : currentId));
    setTasks((currentTasks) => currentTasks.filter((task) => task.id !== id));
  }

  function openTaskDetails(id: Id) {
    setAddTaskDraft(null);
    setAddColumnDraft(null);
    setSelectedTaskId(id);
  }

  function closeTaskDetails() {
    setSelectedTaskId(null);
  }

  function updateTaskTitle(id: Id, content: Task["content"]) {
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

  function updateTaskDescription(
    id: Id,
    description: NonNullable<Task["description"]>,
  ) {
    setTasks((currentTasks) =>
      currentTasks.map((task) => {
        if (task.id !== id) return task;
        return {
          ...task,
          description,
        };
      }),
    );
  }

  const canConfirmAddTask =
    addTaskDraft !== null && addTaskDraft.title.trim().length > 0;
  const canConfirmAddColumn =
    addColumnDraft !== null && addColumnDraft.title.trim().length > 0;

  function toggleBoardZoom() {
    setShouldAnimateTaskLayout(false);
    setIsZoomedOut((currentValue) => !currentValue);
  }

  const moveColumn = useCallback((id: Id, deltaX: number) => {
    setColumns((currentColumns) => {
      const fromIndex = currentColumns.findIndex((column) => column.id === id);
      if (fromIndex === -1) return currentColumns;

      const indexOffset = Math.round(deltaX / columnStepRef.current);
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
      const { taskGap, taskMinHeight } = boardLayoutRef.current;
      const nextPreview = getTaskDragPreview(
        taskId,
        deltaX,
        deltaY,
        columns,
        tasks,
        placeholderHeight,
        columnStepRef.current,
        taskGap,
        taskMinHeight,
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
        const { taskGap, taskMinHeight } = boardLayoutRef.current;
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
                columnStepRef.current,
                taskGap,
                taskMinHeight,
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

      const verticalBoardAutoScrollTarget =
        boardDragMetrics.getBoardVerticalAutoScrollTarget(pointerY);

      if (
        verticalBoardAutoScrollTarget !== null &&
        verticalBoardAutoScrollTarget !== boardDragMetrics.getBoardScrollY()
      ) {
        boardDragMetrics.setBoardScrollY(verticalBoardAutoScrollTarget);

        boardVerticalScrollRef.current?.scrollTo({
          y: verticalBoardAutoScrollTarget,
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

      const { taskGap, taskMinHeight, taskListPadding } = boardLayoutRef.current;
      const targetIndex =
        targetColumnId === null
          ? null
          : boardDragMetrics.getTargetTaskIndex(
              targetColumnId,
              pointerY,
              currentDrag.placeholderHeight,
              targetTaskCount,
              taskGap,
              taskMinHeight,
              taskListPadding,
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
      const overlayX = pointerX - currentDrag.touchOffsetX;
      const overlayY = pointerY - currentDrag.touchOffsetY;

      taskOverlayLayoutRef.current = {
        x: overlayX,
        y: overlayY,
        width: taskOverlayLayoutRef.current?.width ?? 0,
        height: currentDrag.placeholderHeight,
      };

      taskOverlayPosition.setValue({ x: overlayX, y: overlayY });

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
      setSelectedTaskId(null);
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
      taskOverlayLayoutRef.current = {
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
      };
      taskOverlayPosition.setValue({ x: layout.x, y: layout.y });
      taskOverlayOpacity.setValue(0.35);
      taskOverlayScale.setValue(0.96);
      taskOverlayTilt.setValue(0);
      triggerHaptic(() =>
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
      );

      setHiddenDraggingTaskId(task.id);
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
      setHiddenDraggingTaskId(null);
      setTaskDragPreview(null);
      lastTaskDragPreview.current = null;

      if (dropAccepted) {
        triggerHaptic(() =>
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
        );

        if (activeTaskDrag && taskOverlayLayoutRef.current) {
          dropTaskAnimationNonce.current += 1;
          setDropTaskAnimation({
            taskId: activeTaskDrag.task.id,
            fromX: taskOverlayLayoutRef.current.x,
            fromY: taskOverlayLayoutRef.current.y,
            nonce: dropTaskAnimationNonce.current,
          });
        }

        taskOverlayOpacity.stopAnimation();
        taskOverlayScale.stopAnimation();
        taskOverlayTilt.stopAnimation();
        taskOverlayOpacity.setValue(0);
        taskOverlayScale.setValue(1);
        taskOverlayTilt.setValue(0);
        setActiveTaskDrag(null);
        activeTaskDragInfo.current = null;
        lastHapticColumnId.current = null;
        taskOverlayLayoutRef.current = null;
        return;
      }

      Animated.parallel([
        Animated.timing(taskOverlayOpacity, {
          toValue: 0,
          duration: 60,
          useNativeDriver: true,
        }),
        Animated.spring(taskOverlayScale, {
          toValue: 1,
          tension: 100,
          friction: 26,
          useNativeDriver: true,
        }),
        Animated.spring(taskOverlayTilt, {
          toValue: 0,
          tension: 100,
          friction: 26,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setActiveTaskDrag(null);
        activeTaskDragInfo.current = null;
        lastHapticColumnId.current = null;
        taskOverlayLayoutRef.current = null;
      });
    },
    [
      activeTaskDrag,
      stopAutoScrollLoop,
      taskOverlayOpacity,
      taskOverlayScale,
      taskOverlayTilt,
    ],
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

  const handleDropTaskAnimationEnd = useCallback(
    (taskId: Id, nonce: number) => {
      setDropTaskAnimation((currentAnimation) => {
        if (
          currentAnimation?.taskId === taskId &&
          currentAnimation.nonce === nonce
        ) {
          return null;
        }

        return currentAnimation;
      });
    },
    [],
  );

  if (selectedTask) {
    return (
      <SafeAreaView style={styles.screen}>
        <CardDetailsScreen
          task={selectedTask}
          onClose={closeTaskDetails}
          onTitleChange={(title) => updateTaskTitle(selectedTask.id, title)}
          onDescriptionChange={(description) =>
            updateTaskDescription(selectedTask.id, description)
          }
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      {addTaskDraft && (
        <View style={styles.addTaskBar}>
          <TouchableOpacity
            activeOpacity={0.7}
            accessibilityLabel="Cancel adding card"
            accessibilityRole="button"
            onPress={cancelAddingTask}
            style={styles.addTaskBarButton}
          >
            <CloseIcon />
          </TouchableOpacity>
          <Text style={styles.addTaskBarTitle}>Add a card...</Text>
          <TouchableOpacity
            activeOpacity={0.7}
            accessibilityLabel="Confirm adding card"
            accessibilityRole="button"
            disabled={!canConfirmAddTask}
            onPress={confirmAddingTask}
            style={styles.addTaskBarButton}
          >
            <CheckIcon color={canConfirmAddTask ? "#ffffff" : "#6b7280"} />
          </TouchableOpacity>
        </View>
      )}
      {addColumnDraft && (
        <View style={styles.addTaskBar}>
          <TouchableOpacity
            activeOpacity={0.7}
            accessibilityLabel="Cancel adding column"
            accessibilityRole="button"
            onPress={cancelAddingColumn}
            style={styles.addTaskBarButton}
          >
            <CloseIcon />
          </TouchableOpacity>
          <Text style={styles.addTaskBarTitle}>Add a column...</Text>
          <TouchableOpacity
            activeOpacity={0.7}
            accessibilityLabel="Confirm adding column"
            accessibilityRole="button"
            disabled={!canConfirmAddColumn}
            onPress={confirmAddingColumn}
            style={styles.addTaskBarButton}
          >
            <CheckIcon color={canConfirmAddColumn ? "#ffffff" : "#6b7280"} />
          </TouchableOpacity>
        </View>
      )}
      <ScrollView
        ref={boardVerticalScrollRef}
        style={styles.boardVerticalScroll}
        contentContainerStyle={styles.boardVerticalContent}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        onContentSizeChange={(_width, height) => {
          boardDragMetrics.setBoardContentHeight(height);
        }}
        onLayout={(event) => {
          const { y, height } = event.nativeEvent.layout;
          boardDragMetrics.setBoardVerticalViewportLayout(y, height);
        }}
        onScroll={(event) => {
          boardDragMetrics.setBoardScrollY(event.nativeEvent.contentOffset.y);
        }}
        scrollEventThrottle={16}
        scrollEnabled={!isTouchingTask}
        showsVerticalScrollIndicator={false}
      >
        <ScrollView
          ref={boardScrollRef}
          horizontal
          style={styles.boardScroll}
          scrollEnabled={!isTouchingTask}
          directionalLockEnabled
          nestedScrollEnabled
          contentContainerStyle={[
            styles.board,
            {
              paddingHorizontal: boardLayout.boardPaddingHorizontal,
              paddingVertical: boardLayout.boardPaddingVertical,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={(width) => {
            boardHorizontalContentWidthRef.current = width;

            if (addColumnDraft !== null) {
              scrollBoardHorizontallyToEnd(true);
            }
          }}
          onLayout={(event) => {
            const { x, width } = event.nativeEvent.layout;
            boardHorizontalViewportWidthRef.current = width;
            boardDragMetrics.setBoardViewportLayout(x, width);
          }}
          onScroll={(event) => {
            const scrollX = event.nativeEvent.contentOffset.x;

            boardHorizontalScrollXRef.current = scrollX;
            boardDragMetrics.setBoardScrollX(scrollX);
          }}
          scrollEventThrottle={16}
          showsHorizontalScrollIndicator={false}
        >
          <View
            style={[styles.columns, { gap: boardLayout.columnGap }]}
            onLayout={(event) => {
              const { x } = event.nativeEvent.layout;

              boardDragMetrics.setColumnsContainerX(x);
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
                  columnWidth={boardLayout.columnWidth}
                  deleteColumn={deleteColumn}
                  updateColumn={updateColumn}
                  startAddingTask={startAddingTask}
                  deleteTask={deleteTask}
                  addTaskTitle={
                    addTaskDraft?.columnId === col.id ? addTaskDraft.title : ""
                  }
                  isAddingTask={addTaskDraft?.columnId === col.id}
                  onAddTaskTitleChange={updateAddTaskTitle}
                  onSubmitAddingTask={confirmAddingTask}
                  onOpenTaskDetails={openTaskDetails}
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
                  dropTaskAnimation={dropTaskAnimation}
                  onDropTaskAnimationEnd={handleDropTaskAnimationEnd}
                  taskDragPreview={isDropTarget ? taskDragPreview : null}
                  draggingTaskId={hiddenDraggingTaskId}
                  isTaskDragActive={activeTaskDrag !== null}
                  isDropTarget={isDropTarget}
                  isZoomedOut={isZoomedOut}
                  shouldAnimateTaskLayout={shouldAnimateTaskLayout}
                  tasks={tasksByColumn[col.id] ?? []}
                />
              );
            })}
            {addColumnDraft ? (
              <View
                style={[
                  styles.addColumnDraft,
                  {
                    width: boardLayout.columnWidth,
                    minWidth: boardLayout.columnWidth,
                    padding: boardLayout.taskListPadding,
                  },
                ]}
              >
                <TextInput
                  value={addColumnDraft.title}
                  autoFocus
                  placeholder="Column title"
                  placeholderTextColor="#8b949e"
                  onChangeText={updateAddColumnTitle}
                  onSubmitEditing={confirmAddingColumn}
                  returnKeyType="done"
                  style={[
                    styles.addColumnInput,
                    isZoomedOut && styles.compactAddColumnInput,
                  ]}
                  selectionColor="#f43f5e"
                />
              </View>
            ) : (
              <TouchableOpacity
                activeOpacity={0.8}
                accessibilityLabel="Add column"
                accessibilityRole="button"
                onPress={startAddingColumn}
                style={[
                  styles.addColumnButton,
                  {
                    width: boardLayout.columnWidth,
                    minWidth: boardLayout.columnWidth,
                    height: boardLayout.addColumnHeight,
                    padding: boardLayout.addColumnPadding,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.addIcon,
                    {
                      fontSize: boardLayout.addColumnIconSize,
                      lineHeight: boardLayout.addColumnIconSize,
                    },
                  ]}
                >
                  +
                </Text>
                <Text
                  style={[
                    styles.addColumnText,
                    { fontSize: boardLayout.addColumnTextSize },
                  ]}
                >
                  Add Column
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </ScrollView>
      <TouchableOpacity
        activeOpacity={0.8}
        accessibilityLabel={isZoomedOut ? "Zoom in board" : "Zoom out board"}
        accessibilityRole="button"
        disabled={activeTaskDrag !== null}
        onPress={toggleBoardZoom}
        style={[
          styles.zoomButton,
          activeTaskDrag !== null && styles.zoomButtonDisabled,
        ]}
      >
        {isZoomedOut ? <ZoomInIcon /> : <ZoomOutIcon />}
      </TouchableOpacity>
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
              moveTask={moveTask}
              isZoomedOut={isZoomedOut}
              isOverlay
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
  addTaskBar: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#161c22",
    backgroundColor: "#0d1117",
  },
  addTaskBarButton: {
    width: 56,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  addTaskBarTitle: {
    flex: 1,
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  boardVerticalScroll: {
    flex: 1,
  },
  boardVerticalContent: {
    flexGrow: 1,
  },
  boardScroll: {
    flex: 1,
    width: "100%",
  },
  board: {
    flexGrow: 1,
    alignItems: "flex-start",
    justifyContent: "flex-start",
  },
  columns: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  addColumnButton: {
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    borderWidth: 2,
    borderColor: "#161c22",
    borderRadius: 8,
    backgroundColor: "#0d1117",
  },
  addIcon: {
    color: "#ffffff",
  },
  addColumnText: {
    color: "#ffffff",
  },
  addColumnDraft: {
    borderWidth: 2,
    borderColor: "#161c22",
    borderRadius: 8,
    backgroundColor: "#161c22",
  },
  addColumnInput: {
    minHeight: 50,
    color: "#ffffff",
    fontSize: 15,
    padding: 10,
    borderWidth: 2,
    borderColor: "#30363d",
    borderRadius: 12,
    backgroundColor: "#0d1117",
  },
  compactAddColumnInput: {
    minHeight: 38,
    fontSize: 12,
    padding: 8,
    borderRadius: 8,
  },
  zoomButton: {
    position: "absolute",
    right: 18,
    bottom: 32,
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24,
    backgroundColor: "#0d1117",
    zIndex: 30,
    elevation: 30,
  },
  zoomButtonDisabled: {
    opacity: 0.45,
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
