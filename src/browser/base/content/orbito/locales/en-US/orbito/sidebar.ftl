# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

## Sidebar

orbito-sidebar-hide = Hide sidebar
orbito-sidebar-keep-open = Keep sidebar open
orbito-sidebar-collapse = Collapse sidebar
# $label is one of the three above; $shortcut is a key, e.g. "⌘S".
orbito-sidebar-collapse-title = { $label } ({ $shortcut })
orbito-sidebar-bookmarks = Bookmarks
orbito-sidebar-resize = Resize sidebar
orbito-sidebar-resize-title = Drag to resize, double-click to reset

## Tabs

orbito-tabs-list = Tabs
orbito-tabs-new-tab = New tab
orbito-tabs-close-tab = Close tab
orbito-tabs-assistant-working = The assistant is working in this tab
orbito-tabs-orbit = Orbit
orbito-tabs-orbit-running = Working
orbito-tabs-orbit-waiting = Waiting for your approval in the Assistant panel
orbito-tabs-orbit-done = Done, choose what to keep in the Assistant panel
# An Orbit's tooltip. $task is the task's name (orbito-tabs-orbit until it
# is known); $status is one of the three above or, while it works, what its
# last step does.
orbito-tabs-orbit-name = { $task } · { $status }
orbito-tabs-stop-task = Stop the task
orbito-tabs-task-in-progress = Task in progress
orbito-tabs-unnamed-group = Unnamed group
# Shown on a tab another tab is held over while dragged: dropping groups them.
orbito-tabs-hold-new-group = Create group
orbito-tabs-hold-add-to-group = Add to group
# The name a group made by holding a dragged tab over another gets;
# $number is the lowest no group in the window is named with.
orbito-tabs-new-group-name = New group { $number }
# $name is the group's name.
orbito-tabs-group-title =
    { $count ->
        [one] { $name }: { $count } tab
       *[other] { $name }: { $count } tabs
    }
orbito-tabs-close-group = Close group

## Spaces

orbito-spaces-list = Spaces
# $name is the Space's name; $key is its shortcut, e.g. "⌃1".
orbito-spaces-space-title = { $name } ({ $key })
# A Space's dot while a Thread of it waits for an approval.
orbito-spaces-space-waiting = { $name }, waiting for approval
orbito-spaces-space-title-waiting = { $name } ({ $key }) · waiting for approval
orbito-spaces-new = New Space
orbito-spaces-new-full = New Space (at most { $max })
# The name a new Space gets; $number is the lowest no Space has.
orbito-spaces-default-name = Space { $number }
# $name is the new Space's name.
orbito-spaces-created = Created { $name }
orbito-spaces-undo = Undo
# $name is the Space's name.
orbito-spaces-removed = Deleted { $name }
# The Space menu, on a Space's dot or its name over the tab list.
orbito-spaces-menu-rename = Rename
orbito-spaces-menu-settings = Space Settings…
orbito-spaces-menu-remove = Delete Space…
# The field a Space's name is typed in, in place of its name.
orbito-spaces-name = Space name
# The question before a Space is deleted. $name is the Space's name.
orbito-spaces-remove-title = Delete “{ $name }”?
# $count is how many tabs the Space has open, in every window.
orbito-spaces-remove-tabs =
    { $count ->
        [one] Its { $count } tab closes.
       *[other] Its { $count } tabs close.
    }
# What happens to the rest of what is kept in the Space.
orbito-spaces-remove-data = Dock, Threads, memories, skills, documents and scheduled tasks
# $name is the Space they go to.
orbito-spaces-remove-move = Move to { $name }
orbito-spaces-remove-delete = Delete them too
orbito-spaces-remove-cancel = Cancel
orbito-spaces-remove-confirm = Delete
# The tab menu's submenu of the other Spaces.
orbito-spaces-move-tab = Move to Space
orbito-spaces-move-group = Move group to Space

## Pins

orbito-pins-list = Pins
orbito-pins-shared = Pins: shared by every Space
orbito-pins-pin-tab = Pin tab
orbito-pins-unpin-tab = Unpin tab

## Dock

orbito-dock-list = Dock
orbito-dock-close-tab-title = Close tab (it keeps its place in the Dock)
orbito-dock-add = Add to Dock
orbito-dock-remove = Remove from Dock

## Side panel

orbito-side-panel-default-title = Side panel
# $title is the panel's title.
orbito-side-panel-label = { $title } panel
orbito-side-panel-extension = Extension
orbito-side-panel-close = Close extension panel

## Window controls

orbito-window-minimize = Minimize
orbito-window-maximize = Maximize
orbito-window-restore = Restore
orbito-window-close = Close window
