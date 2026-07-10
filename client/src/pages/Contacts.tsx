import React, { useEffect, useMemo, useRef, useState } from 'react';
import InsertContacts from './InsertContacts';
import DeleteConfirmationModal from './DeleteConfirmationModal';
import QSOsForParkNumber from './QSOsForParkNumber';
import CallsignInfo from './CallsignInfo';
import SearchBar from '../components/SearchBar';
import SortableHeader from '../components/SortableHeader';
import { getQsos, deleteQso, exportAdif, importAdif, apiErrorMessage } from '../api/hamlog-api';
import type { Contact, SearchFilters, SortConfig, SortField } from '../types/qso';
import { defaultSearchFilters } from '../types/qso';
import { filterQsos } from '../utils/filter-qsos';
import { sortQsos } from '../utils/sort-qsos';
import { Plus, Download, Upload, ChevronRight, Trash2 } from 'lucide-react';
import config from '../config';
const {
  ButtonClassNameOutline,
  TableHeading1,
  TableHeading2,
  TableCell1,
  TableStyle1,
  TableBodyStyle1,
  TableHeadStyle1,
  TableHeadStyle3,
} = config;

const Contacts = () => {
  const [conditions, setConditions] = useState<Contact[]>([]);
  const [expandedRows, setExpandedRows] = useState<boolean[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [showInsertContacts, setShowInsertContacts] = useState(false);
  const [currentCallsign, setCurrentCallsign] = useState('');
  const [currentQSOId, setCurrentQSOId] = useState<number | null>(null);
  const [showQSOsForParkNumber, setShowQSOsForParkNumber] = useState(false);
  const [currentParkNumber, setCurrentParkNumber] = useState('');
  const [showCallsignInfo, setShowCallsignInfo] = useState(false);
  const [filters, setFilters] = useState<SearchFilters>(defaultSearchFilters);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sort, setSort] = useState<SortConfig>({ field: 'date', direction: 'desc' });

  const displayedConditions = useMemo(
    () => sortQsos(filterQsos(conditions, filters), sort),
    [conditions, filters, sort]
  );
  const isFiltered = Object.values(filters).some(v => v !== '');

  const handleSort = (field: SortField) => {
    setSort(prev => {
      if (prev.field === field) {
        return { field, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { field, direction: field === 'date' ? 'desc' : 'asc' };
    });
  };

  const fetchData = async () => {
    try {
      const data = await getQsos();
      setConditions(data);
    } catch {
      // fetch error handled silently
    }
  };

  const toggleRow = (index: number) => {
    setExpandedRows((prevRows) => {
      const newRows = [...prevRows];
      newRows[index] = !newRows[index];
      return newRows;
    });
  };

  const HandleDelete = (qsoId: number) => {
    setShowModal(true);
    setCurrentQSOId(qsoId);
  };

  const HandleInsert = () => {
    setShowInsertContacts(true);
  };

  const handleUserChoice = async (choice: string) => {
    if (choice === 'Yes' && currentQSOId !== null) {
      try {
        await deleteQso(currentQSOId);
        fetchData();
      } catch {
        // delete error handled silently
      }
    }
    setShowModal(false);
  };

  const handleCallsignMouseOver = (qsoCallsign: string) => {
    setCurrentCallsign(qsoCallsign);
    setShowCallsignInfo(true);
  };

  const handleCallsignMouseLeave = () => {
    setShowCallsignInfo(false);
  };

  const handleParkNumberMouseOver = (parkNumber: string) => {
    setCurrentParkNumber(parkNumber);
    setShowQSOsForParkNumber(true);
  };

  const handleParkNumberMouseLeave = () => {
    setShowQSOsForParkNumber(false);
  };

  const handleInsertContactsClosed = () => {
    fetchData();
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    try {
      await exportAdif();
    } catch {
      alert('Export failed.');
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await importAdif(file);
      let msg = `Imported ${result.imported} QSOs.`;
      if (result.skipped) {
        const dupes = result.skippedRecords.filter(r => r.reason === 'duplicate').length;
        msg += `\nSkipped ${result.skipped}${dupes ? ` (${dupes} duplicate${dupes === 1 ? '' : 's'} already in your log)` : ''}.`;
      }
      alert(msg);
      fetchData();
    } catch (err) {
      alert(apiErrorMessage(err) ?? 'Import failed.');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      {/* Search Bar */}
      <SearchBar
        filters={filters}
        onFiltersChange={setFilters}
        onClear={() => setFilters(defaultSearchFilters)}
        isOpen={searchOpen}
        onToggle={() => setSearchOpen(!searchOpen)}
      />

      {/* Action Toolbar */}
      <div className="bg-[var(--color-card-bg)] border border-[var(--color-card-border)] rounded-xl p-3 mb-4 shadow-card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => HandleInsert()} className="inline-flex items-center gap-1.5 px-3 py-2 bg-accent-600 text-white text-sm font-medium rounded-lg hover:bg-accent-700 transition-colors shadow-sm">
              <Plus className="w-4 h-4" /> New QSO
            </button>
            <button onClick={handleExport} className={ButtonClassNameOutline}>
              <Download className="w-4 h-4" /> Export ADIF
            </button>
            <button onClick={() => fileInputRef.current?.click()} className={ButtonClassNameOutline}>
              <Upload className="w-4 h-4" /> Import ADIF
            </button>
            <input type="file" ref={fileInputRef} accept=".adi,.adif" onChange={handleImport} className="hidden" />
          </div>
          <span className="text-xs font-medium text-[var(--color-text-muted)]">
            {isFiltered
              ? `Showing ${displayedConditions.length} of ${conditions.length} QSOs`
              : `${conditions.length} QSO${conditions.length !== 1 ? 's' : ''}`}
          </span>
        </div>
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block">
        <div className="bg-[var(--color-card-bg)] border border-[var(--color-card-border)] rounded-xl overflow-hidden shadow-card">
          <div className="overflow-x-auto">
            <table id="MainDataTable" className={TableStyle1}>
              <thead className={TableHeadStyle1}>
                <tr>
                  <th scope="col" className={`${TableHeading1} w-16`}></th>
                  <SortableHeader label="Date" field="date" currentSort={sort} onSort={handleSort} className={TableHeading1} />
                  <th scope="col" className={TableHeading1}>Time</th>
                  <SortableHeader label="Callsign" field="callsign" currentSort={sort} onSort={handleSort} className={TableHeading1} />
                  <SortableHeader label="Frequency" field="frequency" currentSort={sort} onSort={handleSort} className={TableHeading1} />
                  <SortableHeader label="Mode" field="mode" currentSort={sort} onSort={handleSort} className={TableHeading1} />
                  <SortableHeader label="Band" field="band" currentSort={sort} onSort={handleSort} className={TableHeading1} />
                  <th scope="col" className={`${TableHeading1} w-16`}></th>
                </tr>
              </thead>
              <tbody className={TableBodyStyle1}>
                {displayedConditions.map((condition, index) => (
                  <React.Fragment key={index}>
                    <tr className={`hover:bg-[var(--color-surface-100)] transition-colors ${index % 2 === 0 ? 'bg-[var(--color-card-bg)]' : 'bg-[var(--color-surface-50)]'}`}>
                      <td className={TableCell1}>
                        <button
                          onClick={() => toggleRow(index)}
                          className="p-1 rounded-md hover:bg-[var(--color-surface-100)] text-[var(--color-text-muted)] transition-all"
                        >
                          <ChevronRight className={`w-4 h-4 transition-transform duration-200 ${expandedRows[index] ? 'rotate-90' : ''}`} />
                        </button>
                      </td>
                      <td className={TableCell1}>{new Date(condition.QSO_Date).toLocaleDateString('en-US')}</td>
                      <td className={`${TableCell1} font-mono tabular-nums`}>{condition.QSO_MTZTime.slice(0, 5)}</td>
                      <td
                        className={`${TableCell1} font-mono font-medium text-primary-600 cursor-pointer hover:text-primary-700`}
                        onMouseLeave={() => handleCallsignMouseLeave()}
                        onMouseOver={() => handleCallsignMouseOver(condition.QSO_Callsign)}
                      >
                        {condition.QSO_Callsign}
                      </td>
                      <td className={`${TableCell1} font-mono tabular-nums`}>{condition.QSO_Frequency}</td>
                      <td className={TableCell1}>{condition.mode || ''}</td>
                      <td className={TableCell1}>{condition.band || ''}</td>
                      <td className={TableCell1}>
                        <button
                          onClick={() => HandleDelete(condition.QSO_ID)}
                          className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-danger-500 hover:bg-danger-500/10 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                    {expandedRows[index] && (
                      <tr>
                        <td colSpan={8} className="p-0">
                          <div className="border-l-2 border-primary-400 bg-[var(--color-surface-50)] p-4 mx-4 mb-2 rounded-r-lg animate-slide-in-up">
                            {condition.POTA_QSOs.length > 0 && (
                              <div className="mb-4">
                                <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">POTA Records</h4>
                                <table className={TableStyle1}>
                                  <thead className={TableHeadStyle3}>
                                    <tr>
                                      <th scope="col" className={TableHeading2}>Park Number</th>
                                      <th scope="col" className={TableHeading2}>QSO Type</th>
                                    </tr>
                                  </thead>
                                  <tbody className={TableBodyStyle1}>
                                    {condition.POTA_QSOs.map((potaQSO, index2) => (
                                      <tr key={potaQSO.POTA_QSO_ID} className={`hover:bg-[var(--color-surface-100)] ${index2 % 2 === 0 ? 'bg-[var(--color-card-bg)]' : 'bg-[var(--color-surface-50)]'}`}>
                                        <td
                                          className={`${TableCell1} font-mono font-medium text-primary-600 cursor-pointer hover:text-primary-700`}
                                          onMouseLeave={() => handleParkNumberMouseLeave()}
                                          onMouseOver={() => handleParkNumberMouseOver(potaQSO.POTAPark_ID)}
                                        >
                                          {potaQSO.POTAPark_ID}
                                        </td>
                                        <td className={TableCell1}>
                                          {potaQSO.QSO_Type === '1' ? 'Hunter' : potaQSO.QSO_Type === '2' ? 'Activator' : ''}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            {(condition.QSO_Received || condition.QSO_Sent || condition.QSO_Notes) && (
                              <div>
                                <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Details</h4>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                  {condition.QSO_Received && (
                                    <div>
                                      <span className="text-xs text-[var(--color-text-muted)]">Received</span>
                                      <p className="text-sm text-[var(--color-text-primary)] font-medium">{condition.QSO_Received}</p>
                                    </div>
                                  )}
                                  {condition.QSO_Sent && (
                                    <div>
                                      <span className="text-xs text-[var(--color-text-muted)]">Sent</span>
                                      <p className="text-sm text-[var(--color-text-primary)] font-medium">{condition.QSO_Sent}</p>
                                    </div>
                                  )}
                                  {condition.QSO_Notes && (
                                    <div className="sm:col-span-3">
                                      <span className="text-xs text-[var(--color-text-muted)]">Notes</span>
                                      <p className="text-sm text-[var(--color-text-primary)] whitespace-pre-wrap">{condition.QSO_Notes}</p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Mobile Card Layout */}
      <div className="md:hidden space-y-2">
        {displayedConditions.map((condition, index) => (
          <div
            key={index}
            className="bg-[var(--color-card-bg)] border border-[var(--color-card-border)] rounded-xl shadow-card overflow-hidden"
          >
            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <span
                  className="font-mono font-bold text-primary-600 text-base cursor-pointer"
                  onClick={() => {
                    if (showCallsignInfo && currentCallsign === condition.QSO_Callsign) {
                      handleCallsignMouseLeave();
                    } else {
                      handleCallsignMouseOver(condition.QSO_Callsign);
                    }
                  }}
                >
                  {condition.QSO_Callsign}
                </span>
                <span className="text-xs text-[var(--color-text-muted)]">
                  {new Date(condition.QSO_Date).toLocaleDateString('en-US')} {condition.QSO_MTZTime.slice(0, 5)}
                </span>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-[var(--color-surface-100)] text-xs font-mono text-[var(--color-text-secondary)]">
                  {condition.QSO_Frequency}
                </span>
                {condition.mode && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-primary-500/10 text-xs font-medium text-primary-600">
                    {condition.mode}
                  </span>
                )}
                {condition.band && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-accent-500/10 text-xs font-medium text-accent-600">
                    {condition.band}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1 mt-2 pt-2 border-t border-[var(--color-surface-100)]">
                <button
                  onClick={() => toggleRow(index)}
                  className="p-1.5 rounded-md hover:bg-[var(--color-surface-100)] text-[var(--color-text-muted)] transition-all text-xs flex items-center gap-1"
                >
                  <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${expandedRows[index] ? 'rotate-90' : ''}`} />
                  Details
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => HandleDelete(condition.QSO_ID)}
                  className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-danger-500 hover:bg-danger-500/10 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {expandedRows[index] && (
              <div className="border-t border-[var(--color-card-border)] bg-[var(--color-surface-50)] p-3 space-y-3 animate-slide-in-up">
                {condition.POTA_QSOs.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)] mb-1.5">POTA</h4>
                    {condition.POTA_QSOs.map((potaQSO) => (
                      <div key={potaQSO.POTA_QSO_ID} className="flex items-center gap-2">
                        <span
                          className="font-mono text-sm font-medium text-primary-600 cursor-pointer"
                          onClick={() => {
                            if (showQSOsForParkNumber && currentParkNumber === potaQSO.POTAPark_ID) {
                              handleParkNumberMouseLeave();
                            } else {
                              handleParkNumberMouseOver(potaQSO.POTAPark_ID);
                            }
                          }}
                        >
                          {potaQSO.POTAPark_ID}
                        </span>
                        <span className="text-xs text-[var(--color-text-muted)]">
                          {potaQSO.QSO_Type === '1' ? 'Hunter' : potaQSO.QSO_Type === '2' ? 'Activator' : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {(condition.QSO_Received || condition.QSO_Sent || condition.QSO_Notes) && (
                  <div className="space-y-1.5">
                    {condition.QSO_Received && (
                      <div className="flex gap-2">
                        <span className="text-xs text-[var(--color-text-muted)] w-16 shrink-0">Received</span>
                        <span className="text-sm text-[var(--color-text-primary)]">{condition.QSO_Received}</span>
                      </div>
                    )}
                    {condition.QSO_Sent && (
                      <div className="flex gap-2">
                        <span className="text-xs text-[var(--color-text-muted)] w-16 shrink-0">Sent</span>
                        <span className="text-sm text-[var(--color-text-primary)]">{condition.QSO_Sent}</span>
                      </div>
                    )}
                    {condition.QSO_Notes && (
                      <div className="flex gap-2">
                        <span className="text-xs text-[var(--color-text-muted)] w-16 shrink-0">Notes</span>
                        <span className="text-sm text-[var(--color-text-primary)] whitespace-pre-wrap">{condition.QSO_Notes}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Modals and Info Panels */}
      <DeleteConfirmationModal isOpen={showModal} onClose={() => setShowModal(false)} onConfirm={handleUserChoice} />
      <InsertContacts isOpen={showInsertContacts} onClose={() => setShowInsertContacts(false)} onClosed={handleInsertContactsClosed} />
      <CallsignInfo callSignToSearchFor={currentCallsign} isOpen={showCallsignInfo} />
      <QSOsForParkNumber parkNumberToSearchFor={currentParkNumber} isOpen={showQSOsForParkNumber} displayTime={false} />
    </>
  );
};

export default Contacts;
