import { useState } from 'react';

export function useSidebarSize() {
  const [width, setWidth] = useState(240);
  const [collapsed, setCollapsed] = useState(false);
  return { width, collapsed, setCollapsed, resize: value => setWidth(Math.max(180, Math.min(360, value))) };
}
