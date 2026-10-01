// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PerfHistory from './PerfHistory';
import { perfStore } from '../../lib/perf/profilerStore';
import { historyFixture } from '../../lib/perf/history.fixtures';
const mocks=vi.hoisted(()=>({save:vi.fn().mockResolvedValue(undefined),watch:vi.fn(()=>vi.fn()),user:{uid:'owner'} as {uid:string}|null,download:vi.fn()}));
vi.mock('../../AppContext',()=>({useApp:()=>({user:mocks.user})}));
vi.mock('../../lib/perf/historyCloud',()=>({saveBenchmarkCloud:mocks.save,watchBenchmarkCloud:mocks.watch}));
vi.mock('../../lib/presentation/recorder',()=>({downloadBlob:mocks.download}));
beforeEach(()=>{mocks.user={uid:'owner'};perfStore.clearRuns();perfStore.setContext({scenario:''});vi.clearAllMocks();});
afterEach(()=>{cleanup();perfStore.clearRuns();});
describe('Benchmark history controls',()=>{
  it('compares a chosen baseline and warns when scenarios differ',()=>{
    const before=historyFixture('baseline'),after={...historyFixture('after'),context:{...before.context!,scenario:'Interior'},stats:{...before.stats,fpsAvg:30},startedAt:'2026-10-01T10:00:00Z'};
    perfStore.importRuns([before,after]);render(<PerfHistory onClose={()=>{}}/>);
    expect(screen.getByText('Scenario changed.')).toBeTruthy();expect(screen.getByText('Average fps')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox',{name:'Filter benchmark history'}),{target:{value:'Interior'}});
    expect(screen.queryByRole('button',{name:'View baseline'})).toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();expect(mocks.watch).not.toHaveBeenCalled();
  });
  it('only saves to cloud on request and connects/disconnects the live account history',async()=>{
    perfStore.importRuns([historyFixture()]);render(<PerfHistory onClose={()=>{}}/>);
    fireEvent.click(screen.getByRole('button',{name:'Save selected to cloud'}));
    await waitFor(()=>expect(mocks.save).toHaveBeenCalledWith('owner',expect.objectContaining({id:'run-1'})));
    fireEvent.click(screen.getByRole('button',{name:'Load cloud history'}));await waitFor(()=>expect(mocks.watch).toHaveBeenCalledOnce());
    const unsubscribe=mocks.watch.mock.results[0].value;
    fireEvent.click(screen.getByRole('button',{name:'Disconnect cloud'}));expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it('keeps text input focus when profiler updates recreate the close callback',()=>{
    const view=render(<PerfHistory onClose={()=>{}}/>),input=screen.getByRole('textbox',{name:'Next benchmark scenario'});input.focus();
    view.rerender(<PerfHistory onClose={()=>{}}/>);expect(document.activeElement).toBe(input);
  });
  it('sets the next scenario, exports history and disables cloud actions without sign-in',()=>{
    mocks.user=null;perfStore.importRuns([historyFixture()]);render(<PerfHistory onClose={()=>{}}/>);
    fireEvent.change(screen.getByRole('textbox',{name:'Next benchmark scenario'}),{target:{value:'Meadow walkthrough'}});
    expect(perfStore.getContext().scenario).toBe('Meadow walkthrough');
    fireEvent.click(screen.getByRole('button',{name:'Export history'}));expect(mocks.download).toHaveBeenCalledOnce();
    expect((screen.getByRole('button',{name:'Save selected to cloud'}) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button',{name:'Load cloud history'}) as HTMLButtonElement).disabled).toBe(true);
  });
});
