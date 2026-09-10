import { useRef } from 'react';

export function SidebarResize({ width, collapsed, resize, setCollapsed }) {
  const drag = useRef(null);
  return <div className="sidebar-resize-controls">
    <button className="sidebar-collapse" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}
      aria-controls="planner-sidebar" title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed(!collapsed)}>{collapsed ? '›' : '‹'}</button>
    {!collapsed && <div className="sidebar-divider" role="separator" tabIndex={0} aria-label="Resize sidebar"
      aria-orientation="vertical" aria-valuemin={180} aria-valuemax={360} aria-valuenow={width}
      aria-controls="planner-sidebar" title="Drag to resize sidebar, or use arrow keys"
      onPointerDown={event => {
        if (event.button !== 0) return;
        drag.current = { x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={event => { if (drag.current) resize(drag.current.width + event.clientX - drag.current.x); }}
      onPointerUp={event => { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        resize(event.key === 'Home' ? 180 : event.key === 'End' ? 360 : width + (event.key === 'ArrowLeft' ? -10 : 10));
      }} />}
  </div>;
}
