//! Iterative Tarjan strongly-connected components (explicit stack, no recursion).

/// Returns every strongly connected component of the graph with `n` nodes.
pub fn strongly_connected(n: usize, adj: &[Vec<usize>]) -> Vec<Vec<usize>> {
    const UNVISITED: usize = usize::MAX;
    let mut index = vec![UNVISITED; n];
    let mut low = vec![0usize; n];
    let mut on_stack = vec![false; n];
    let mut stack: Vec<usize> = Vec::new();
    let mut next_index = 0usize;
    let mut out: Vec<Vec<usize>> = Vec::new();
    // (node, next neighbour position)
    let mut call: Vec<(usize, usize)> = Vec::new();

    for root in 0..n {
        if index[root] != UNVISITED {
            continue;
        }
        call.push((root, 0));
        index[root] = next_index;
        low[root] = next_index;
        next_index += 1;
        stack.push(root);
        on_stack[root] = true;

        while let Some(&(v, pos)) = call.last() {
            let neighbours = adj.get(v).map(Vec::as_slice).unwrap_or(&[]);
            if pos < neighbours.len() {
                if let Some(top) = call.last_mut() {
                    top.1 += 1;
                }
                let w = neighbours[pos];
                if w >= n {
                    continue;
                }
                if index[w] == UNVISITED {
                    index[w] = next_index;
                    low[w] = next_index;
                    next_index += 1;
                    stack.push(w);
                    on_stack[w] = true;
                    call.push((w, 0));
                } else if on_stack[w] {
                    low[v] = low[v].min(index[w]);
                }
            } else {
                call.pop();
                if let Some(&(parent, _)) = call.last() {
                    low[parent] = low[parent].min(low[v]);
                }
                if low[v] == index[v] {
                    let mut comp = Vec::new();
                    while let Some(w) = stack.pop() {
                        on_stack[w] = false;
                        comp.push(w);
                        if w == v {
                            break;
                        }
                    }
                    out.push(comp);
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_components() {
        let adj = vec![vec![1], vec![2], vec![0], vec![3], vec![]];
        let mut comps = strongly_connected(5, &adj);
        for c in comps.iter_mut() {
            c.sort();
        }
        comps.sort();
        assert_eq!(comps, vec![vec![0, 1, 2], vec![3], vec![4]]);
    }
}
