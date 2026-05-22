export type Id = string;

export type Column = {
  id: Id;
  title: string;
};

export type Task = {
  id: Id;
  columnId: Column["id"];
  content: string;
  description?: string;
};

export type TaskDragLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
  touchOffsetX: number;
  touchOffsetY: number;
};

export type ColumnScrollMetrics = {
  windowY: number;
  viewportHeight: number;
  contentHeight: number;
  scrollY: number;
  scrollTo: (y: number) => void;
};

export type TaskListItemLayout = {
  taskId: Id;
  y: number;
  height: number;
};
