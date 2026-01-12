import React, { useEffect, useRef } from 'react';
import { CoreApp, LogSortOrderChangeEvent, LogsSortOrder, QueryEditorProps, store } from '@grafana/data';
import { CodeEditor, monacoTypes } from '@grafana/ui';
import { getAppEvents } from '@grafana/runtime';
import { Datasource } from 'data/CHDatasource';
import { registerSQL, Range, Fetcher } from './sqlProvider';
import { CHConfig } from 'types/config';
import { CHQuery, EditorType, CHSqlQuery, LogsQueryDirection } from 'types/sql';
import { styles } from 'styles';
import { getSuggestions } from './suggestions';
import { validate } from 'data/validate';
import { mapQueryTypeToGrafanaFormat } from 'data/utils';
import { QueryType } from 'types/queryBuilder';
import { QueryTypeSwitcher } from 'components/queryBuilder/QueryTypeSwitcher';
import { pluginVersion } from 'utils/version';
import { useSchemaSuggestionsProvider } from 'hooks/useSchemaSuggestionsProvider';
import { QueryToolbox } from './QueryToolbox';

type SqlEditorProps = QueryEditorProps<Datasource, CHQuery, CHConfig>;

const LOGS_SORT_ORDER_KEY = 'grafana.explore.logs.sortOrder';

/**
 * Get the default query direction based on the current app context and stored sort order.
 * This syncs with Grafana's Explore logs sort order (Newest first / Oldest first).
 */
function getDefaultQueryDirection(app?: CoreApp | string): LogsQueryDirection {
  // Outside Explore, default to backward (newest first)
  if (app !== CoreApp.Explore) {
    return 'backward';
  }
  // In Explore, sync with stored sort order
  const storedOrder = store.get(LOGS_SORT_ORDER_KEY) || LogsSortOrder.Descending;
  return storedOrder === LogsSortOrder.Ascending ? 'forward' : 'backward';
}

function setupAutoSize(editor: monacoTypes.editor.IStandaloneCodeEditor) {
  const container = editor.getDomNode();
  const updateHeight = () => {
    if (container) {
      const contentHeight = Math.max(100, Math.min(1000, editor.getContentHeight()));
      const width = parseInt(container.style.width, 10);
      container.style.width = `${width}px`;
      container.style.height = `${contentHeight}px`;
      editor.layout({ width, height: contentHeight });
    }
  };
  editor.onDidContentSizeChange(updateHeight);
  updateHeight();
}

export const SqlEditor = (props: SqlEditorProps) => {
  const { query, onChange, datasource, app } = props;
  const editorRef = useRef<monacoTypes.editor.IStandaloneCodeEditor | null>(null);
  const sqlQuery = query as CHSqlQuery;
  const queryType = sqlQuery.queryType || QueryType.Table;

  // Track previous sort order to detect changes (for Explore polling)
  const previousSortOrderRef = useRef<LogsSortOrder | undefined>();

  // Helper to convert LogsSortOrder to LogsQueryDirection
  const sortOrderToDirection = (order: LogsSortOrder): LogsQueryDirection => {
    return order === LogsSortOrder.Ascending ? 'forward' : 'backward';
  };

  const saveChanges = (changes: Partial<CHSqlQuery>) => {
    onChange({
      ...sqlQuery,
      pluginVersion,
      editorType: EditorType.SQL,
      format: mapQueryTypeToGrafanaFormat(changes.queryType || queryType),
      ...changes,
    });
  };

  // Initialize direction when query type changes to Logs
  useEffect(() => {
    if (queryType === QueryType.Logs && !sqlQuery.direction) {
      const defaultDirection = getDefaultQueryDirection(app);
      saveChanges({ direction: defaultDirection });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryType]);

  // Subscribe to sort order changes for Dashboard/PanelEditor
  // In these contexts, Grafana publishes LogSortOrderChangeEvent when sort order changes
  useEffect(() => {
    if (queryType !== QueryType.Logs || (app !== CoreApp.Dashboard && app !== CoreApp.PanelEditor)) {
      return;
    }

    const subscription = getAppEvents().subscribe(LogSortOrderChangeEvent, (event: LogSortOrderChangeEvent) => {
      const newDirection = sortOrderToDirection(event.payload.order);
      if (newDirection !== sqlQuery.direction) {
        saveChanges({ direction: newDirection });
      }
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryType, app]);

  // Poll sort order changes in Explore
  //
  // WHY POLLING IS NECESSARY:
  // Unlike Dashboard/PanelEditor which publishes LogSortOrderChangeEvent when users
  // change the sort order, Grafana Explore does NOT emit this event. Instead, it only
  // updates the browser's localStorage directly. Since there's no public API or event
  // to subscribe to for Explore sort order changes, we must poll the store to detect
  // when users click "Newest first" / "Oldest first" in the Explore logs panel.
  //
  // This is a known Grafana limitation - the event system is inconsistent across contexts.
  // See: https://github.com/grafana/grafana/issues/66819
  useEffect(() => {
    if (app !== CoreApp.Explore || queryType !== QueryType.Logs) {
      return;
    }

    // Initialize previous order on first run
    if (!previousSortOrderRef.current) {
      previousSortOrderRef.current = store.get(LOGS_SORT_ORDER_KEY);
    }

    const interval = setInterval(() => {
      const currentOrder = store.get(LOGS_SORT_ORDER_KEY);

      // Only update if order actually changed
      if (currentOrder !== previousSortOrderRef.current) {
        previousSortOrderRef.current = currentOrder;
        const newDirection = sortOrderToDirection(currentOrder);

        if (newDirection !== sqlQuery.direction) {
          saveChanges({ direction: newDirection });
        }
      }
    }, 500); // 500ms provides responsive UX without excessive CPU usage

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryType, app]);

  const schema = useSchemaSuggestionsProvider(datasource);

  const _getSuggestions: Fetcher = async (text: string, range: Range, cursorPosition: number) => {
    const suggestions = await getSuggestions(text, schema, range, cursorPosition);
    return { suggestions };
  };

  const validateSql = (sql: string, model: any, me: any) => {
    const v = validate(sql);
    const errorSeverity = 8;
    if (v.valid) {
      me.setModelMarkers(model, 'clickhouse', []);
    } else {
      const err = v.error!;
      me.setModelMarkers(model, 'clickhouse', [
        {
          startLineNumber: err.startLine,
          startColumn: err.startCol,
          endLineNumber: err.endLine,
          endColumn: err.endCol,
          message: err.expected,
          severity: errorSeverity,
        },
      ]);
    }
  };

  const handleMount = (editor: monacoTypes.editor.IStandaloneCodeEditor, monaco: typeof monacoTypes) => {
    editorRef.current = editor;
    const me = registerSQL('sql', editor, _getSuggestions);
    setupAutoSize(editor);
    editor.onKeyUp((e: any) => {
      if (datasource.settings.jsonData.validateSql) {
        const sql = editor.getValue();
        validateSql(sql, editor.getModel(), me);
      }
    });

    editor.addAction({
      id: 'run-query',
      label: 'Run Query',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.5,
      run: (editor: monacoTypes.editor.IStandaloneCodeEditor) => {
        saveChanges({ rawSql: editor.getValue() });
        props.onRunQuery();
      },
    });
  };

  const onEditorWillUnmount = () => {
    editorRef.current = null;
  };
  const triggerFormat = () => {
    if (editorRef.current !== null) {
      editorRef.current.trigger('editor', 'editor.action.formatDocument', '');
    }
  };

  return (
    <>
      <div className={'gf-form ' + styles.QueryEditor.queryType}>
        <QueryTypeSwitcher queryType={queryType} onChange={(queryType) => saveChanges({ queryType })} sqlEditor />
      </div>
      <div className={styles.Common.wrapper}>
        <CodeEditor
          aria-label="SQL Editor"
          language="sql"
          value={query.rawSql}
          onSave={(sql) => saveChanges({ rawSql: sql })}
          showMiniMap={false}
          showLineNumbers={true}
          onBlur={(sql) => saveChanges({ rawSql: sql })}
          onEditorDidMount={handleMount}
          onEditorWillUnmount={onEditorWillUnmount}
        />
        <QueryToolbox showTools onFormatCode={triggerFormat} />
      </div>
    </>
  );
};
