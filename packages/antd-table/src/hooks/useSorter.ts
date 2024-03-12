import { computed, type ComputedRef, ref } from 'vue'
import type {
  ColumnKey,
  CompareFn,
  InternalRowData,
  OnUpdateSorterImpl,
  SortOrder,
  SortState,
  TableBaseColumn,
  TableExpandColumn,
  TableSelectionColumn,
  TmNode
} from '../types'
import { getFlagOfOrder, genSortState } from '../utils'
import { call } from '../utils/call'

function getMultiplePriority(
  sorter: TableBaseColumn['sorter']
): number | false {
  if (typeof sorter === 'object' && typeof sorter.multiple === 'number') {
    return sorter.multiple
  }
  return false
}

function getSortFunction(
  sorter: TableBaseColumn['sorter'],
  columnKey: ColumnKey
): CompareFn | false {
  if (
    columnKey &&
    (sorter === undefined ||
      sorter === 'default' ||
      (typeof sorter === 'object' && sorter.compare === 'default'))
  ) {
    return getDefaultSorterFn(columnKey)
  }
  if (typeof sorter === 'function') {
    return sorter
  }
  if (
    sorter &&
    typeof sorter === 'object' &&
    sorter.compare &&
    sorter.compare !== 'default'
  ) {
    return sorter.compare
  }
  return false
}

function getDefaultSorterFn(
  columnKey: ColumnKey
): (row1: InternalRowData, row2: InternalRowData) => number {
  return (row1: InternalRowData, row2: InternalRowData) => {
    const value1 = row1[columnKey]
    const value2 = row2[columnKey]

    if (value1 === null || value1 === undefined) {
      if (value2 === null || value2 === undefined) return 0
      return -1
    } else if (value2 === null || value2 === undefined) {
      return 1
    } else if (typeof value1 === 'number' && typeof value2 === 'number') {
      return value1 - value2
    } else if (typeof value1 === 'string' && typeof value2 === 'string') {
      return value1.localeCompare(value2)
    }
    return 0
  }
}

export function useSorter(
  props: TableProps,
  {
    dataRelatedCols,
    filteredData
  }: {
    dataRelatedCols: ComputedRef<
      Array<TableSelectionColumn | TableBaseColumn | TableExpandColumn>
    >
    filteredData: ComputedRef<TmNode[]>
  }
) {
  const defaultSortState: SortState[] = []

  // initialize
  dataRelatedCols.value.forEach(column => {
    if (column.sorter !== undefined) {
      updateSortStatesByNewSortState(
        defaultSortState,
        genSortState({
          columnKey: column.key,
          sorter: column.sorter,
          order: column.defaultSortOrder ?? false
        })
      )
    }
  })

  const uncontrolledSortState = ref<SortState | SortState[] | null>(
    defaultSortState
  )
  const mergedSortState = computed(() => {
    const columnsWithControlledSortOrder = dataRelatedCols.value.filter(
      column =>
        column.type !== 'selection' &&
        column.sorter !== undefined &&
        (column.sortOrder === 'ascend' ||
          column.sortOrder === 'descend' ||
          column.sortOrder === false)
    )
    const columnToSort: TableBaseColumn[] | undefined = (
      columnsWithControlledSortOrder as TableBaseColumn[]
    ).filter((col: TableBaseColumn) => col.sortOrder !== false)
    if (columnToSort.length) {
      return columnToSort.map(column => {
        return genSortState(column)
      })
    }
    if (columnsWithControlledSortOrder.length) return []
    if (Array.isArray(uncontrolledSortState.value)) {
      return uncontrolledSortState.value
    } else if (uncontrolledSortState.value) {
      return [uncontrolledSortState.value]
    } else {
      return []
    }
  })
  const sortedData = computed<TmNode[]>(() => {
    const activeSorters = mergedSortState.value.slice().sort((a, b) => {
      const item1Priority = getMultiplePriority(a.sorter) || 0
      const item2Priority = getMultiplePriority(b.sorter) || 0
      return item2Priority - item1Priority
    })
    if (activeSorters.length) {
      const _filteredData = filteredData.value.slice()
      return _filteredData.sort((tmNode1, tmNode2) => {
        let compareResult = 0
        activeSorters.some(sorterState => {
          const { columnKey, sorter, order } = sorterState

          const compareFn = getSortFunction(sorter, columnKey)
          if (compareFn && order) {
            compareResult = compareFn(tmNode1.rawNode, tmNode2.rawNode)

            if (compareResult !== 0) {
              compareResult = compareResult * getFlagOfOrder(order)
              return true
            }
          }
          return false
        })
        return compareResult
      })
    }
    return filteredData.value
  })

  function getUpdatedSorterState(
    sortState: SortState | null
  ): SortState | SortState[] | null {
    let currentSortState = mergedSortState.value.slice()
    // Multiple sorter (if you clicked on a multiple sort column)
    if (sortState && getMultiplePriority(sortState.sorter) !== false) {
      // clear column is not multiple sort
      currentSortState = currentSortState.filter(
        sortState => getMultiplePriority(sortState.sorter) !== false
      )
      updateSortStatesByNewSortState(currentSortState, sortState)
      return currentSortState
    } else if (sortState) {
      // single sorter
      return sortState
    }
    // no sorter
    return null
  }

  function deriveNextSorter(sortState: SortState | null): void {
    const nextSorterState: SortState | SortState[] | null =
      getUpdatedSorterState(sortState)
    doUpdateSorter(nextSorterState)
  }

  function doUpdateSorter(sortState: SortState | SortState[] | null): void {
    const {
      'onUpdate:sorter': _onUpdateSorter,
      onUpdateSorter,
      onSorterChange
    } = props

    if (_onUpdateSorter) {
      call(_onUpdateSorter as OnUpdateSorterImpl, sortState)
    }
    if (onUpdateSorter) {
      call(onUpdateSorter as OnUpdateSorterImpl, sortState)
    }
    if (onSorterChange) {
      call(onSorterChange as OnUpdateSorterImpl, sortState)
    }
    uncontrolledSortState.value = sortState
  }

  function sort(columnKey: ColumnKey, order: SortOrder = 'ascend'): void {
    if (!columnKey) {
      clearSorter()
    } else {
      const columnToSort = dataRelatedCols.value.find(
        column =>
          column.type !== 'selection' &&
          column.type !== 'expand' &&
          column.key === columnKey
      )
      if (!columnToSort?.sorter) return
      const sorter = columnToSort.sorter
      deriveNextSorter(
        genSortState(columnToSort, {
          columnKey,
          sorter,
          order
        })
      )
    }
  }

  function clearSorter(): void {
    doUpdateSorter(null)
  }

  function updateSortStatesByNewSortState(
    sortStates: SortState[],
    sortState: SortState
  ): void {
    const index = sortStates.findIndex(
      state => sortState?.columnKey && state.columnKey === sortState.columnKey
    )
    if (index !== undefined && index >= 0) {
      sortStates[index] = sortState
    } else {
      sortStates.push(sortState)
    }
  }

  return {
    clearSorter,
    sort,
    sortedData,
    mergedSortState,
    deriveNextSorter
  }
}
