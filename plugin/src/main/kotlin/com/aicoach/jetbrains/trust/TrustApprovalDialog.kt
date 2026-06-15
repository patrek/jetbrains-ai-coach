package com.aicoach.jetbrains.trust

import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.ui.components.JBLabel
import com.intellij.ui.table.JBTable
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Dimension
import java.nio.file.Path
import javax.swing.Action
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.ListSelectionModel
import javax.swing.table.AbstractTableModel

/**
 * The rule/metric trust review dialog (decision D5).
 *
 * Lists every locally-authored rule/metric the sidecar blocked as untrusted and
 * lets the user inspect the source (**View Source** opens the file in the IDE
 * editor) and approve them. Pending entries are never executed and appear in no
 * dashboard page or MCP output until approved here.
 *
 * The dialog records no hashes itself: approval is sidecar-driven against the
 * AS-LOADED content (the TOCTOU guard lives in `rule-scope.ts`). It only collects
 * which file paths the user chose; [approvedPaths] is read by the caller after a
 * successful close.
 */
class TrustApprovalDialog(
    private val project: Project,
    private val pending: List<PendingRule>,
) : DialogWrapper(project) {

    /** File paths the user elected to approve (empty when rejected). */
    var approvedPaths: List<String> = emptyList()
        private set

    private val table = JBTable(PendingTableModel(pending)).apply {
        setSelectionMode(ListSelectionModel.MULTIPLE_INTERVAL_SELECTION)
        if (pending.isNotEmpty()) setRowSelectionInterval(0, 0)
    }

    init {
        title = "Review Local Rules"
        init()
    }

    override fun createCenterPanel(): JComponent {
        val panel = JPanel(BorderLayout(0, JBUI.scale(8)))
        panel.preferredSize = Dimension(JBUI.scale(620), JBUI.scale(320))

        val header = JBLabel(
            "These locally-authored rules and metrics are untrusted and will not run " +
                "until you approve them. Review the source before approving.",
        )
        header.border = JBUI.Borders.emptyBottom(4)
        panel.add(header, BorderLayout.NORTH)

        panel.add(com.intellij.ui.components.JBScrollPane(table), BorderLayout.CENTER)

        val viewSource = javax.swing.JButton("View Source").apply {
            addActionListener { openSelectedSource() }
        }
        val south = JPanel(java.awt.FlowLayout(java.awt.FlowLayout.LEFT, 0, 0))
        south.add(viewSource)
        panel.add(south, BorderLayout.SOUTH)
        return panel
    }

    private fun openSelectedSource() {
        val row = table.selectedRow.takeIf { it >= 0 } ?: return
        val filePath = pending[table.convertRowIndexToModel(row)].filePath
        val vf = LocalFileSystem.getInstance().refreshAndFindFileByNioFile(Path.of(filePath)) ?: return
        OpenFileDescriptor(project, vf).navigate(true)
    }

    override fun createActions(): Array<Action> {
        val approveSelected = object : DialogWrapperAction("Approve Selected") {
            override fun doAction(e: java.awt.event.ActionEvent?) {
                val rows = table.selectedRows
                if (rows.isEmpty()) return
                approvedPaths = rows.map { pending[table.convertRowIndexToModel(it)].filePath }
                close(OK_EXIT_CODE)
            }
        }
        val approveAll = object : DialogWrapperAction("Approve All") {
            override fun doAction(e: java.awt.event.ActionEvent?) {
                approvedPaths = pending.map { it.filePath }
                close(OK_EXIT_CODE)
            }
        }
        // Reject = close without approving anything (pending entries re-surface
        // on the next load — parity with upstream's in-memory pending list).
        cancelAction.putValue(Action.NAME, "Reject")
        return arrayOf(approveSelected, approveAll, cancelAction)
    }

    private class PendingTableModel(private val rows: List<PendingRule>) : AbstractTableModel() {
        private val columns = arrayOf("File", "Layer", "Kind")
        override fun getRowCount() = rows.size
        override fun getColumnCount() = columns.size
        override fun getColumnName(column: Int) = columns[column]
        override fun isCellEditable(rowIndex: Int, columnIndex: Int) = false
        override fun getValueAt(rowIndex: Int, columnIndex: Int): Any {
            val entry = rows[rowIndex]
            return when (columnIndex) {
                0 -> entry.filePath
                1 -> entry.layer
                else -> entry.kind
            }
        }
    }
}
