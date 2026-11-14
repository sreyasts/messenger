package com.privatemessenger.app.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf

class FileTransferWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val transferId = inputData.getString("TRANSFER_ID") ?: return Result.failure()
        val fileName = inputData.getString("FILE_NAME") ?: "file"
        val fileSize = inputData.getLong("FILE_SIZE", 0L)

        // WorkManager background task logic
        setProgress(workDataOf("BYTES_TRANSFERRED" to fileSize, "STATUS" to "COMPLETED"))

        return Result.success(
            workDataOf(
                "TRANSFER_ID" to transferId,
                "STATUS" to "SUCCESS"
            )
        )
    }
}
