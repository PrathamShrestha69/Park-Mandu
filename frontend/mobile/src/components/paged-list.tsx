import type { ReactElement, ReactNode } from "react";
import { ActivityIndicator, FlatList, RefreshControl, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { Query } from "@/lib/api";
import { usePaged } from "@/lib/queries";
import { usePalette } from "@/lib/theme";

import { ErrorView, Loading, Txt } from "./ui";

/**
 * Full-screen list backed by server-side pagination: pull to refresh, loads the next page on scroll,
 * and shows loading / error / empty states.
 */
export function PagedList<T extends { id: string }>({
  path,
  query,
  header,
  renderItem,
  empty,
  size = 20,
  refetchInterval,
}: {
  path: string;
  query?: Query;
  header?: ReactElement;
  renderItem: (item: T) => ReactNode;
  empty: ReactElement;
  size?: number;
  refetchInterval?: number;
}) {
  const p = usePalette();
  const list = usePaged<T>(path, query, { size, refetchInterval });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: p.page }} edges={["top"]}>
      <FlatList
        data={list.items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <View style={{ marginBottom: 10 }}>{renderItem(item)}</View>}
        ListHeaderComponent={header}
        ListEmptyComponent={list.isPending ? <Loading /> : list.isError ? <ErrorView error={list.error} onRetry={() => list.refetch()} /> : empty}
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <ActivityIndicator color={p.primary} style={{ marginVertical: 16 }} />
          ) : list.items.length > 0 ? (
            <Txt variant="small" style={{ textAlign: "center", marginVertical: 14 }}>
              {list.hasNextPage ? " " : `${list.total} result${list.total === 1 ? "" : "s"}`}
            </Txt>
          ) : undefined
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
        refreshControl={<RefreshControl refreshing={list.isRefetching && !list.isFetchingNextPage} onRefresh={() => void list.refetch()} tintColor={p.primary} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      />
    </SafeAreaView>
  );
}
